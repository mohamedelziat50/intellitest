/**
 * Validation Pipeline — every AI response passes through these steps in order:
 *
 *   Step 1 — Structural    Is it valid JSON? Do required top-level keys exist?
 *   Step 2 — Type          Are arrays, strings, and objects the right types?
 *   Step 3 — Business      Are test case objects meaningful?
 *   Step 4 — Safety        Does the output contain harmful patterns?
 *
 * Each step is a pure function:
 *   (parsed: unknown) => { ok: boolean, reason?: string }
 *
 * `runValidationPipeline` is the public entry-point:
 *   (raw: string, schema: SchemaDescriptor) => ValidationResult
 */

import { logger } from "../utils/logger.js";

// ── safety blocklist ──────────────────────────────────────────────────────────

/**
 * Patterns that must NOT appear in any string value inside the AI output.
 * These cover script injection, shell execution, and eval abuse.
 */
const UNSAFE_PATTERNS = [
  // Shell command injection
  /\b(exec|spawn|system|popen|subprocess)\s*\(/i,
  // Node.js require / import of dangerous built-ins
  /require\s*\(\s*['"](?:child_process|fs|net|http|os)['"]\s*\)/,
  /import\s+\w+\s+from\s+['"](?:child_process|fs|net|http|os)['"]/,
  // Dynamic code eval
  /\beval\s*\(/i,
  /new\s+Function\s*\(/i,
  // Script tag injection
  /<script[\s>]/i,
  // SQL-ish command injection markers
  /;\s*(drop|truncate|delete\s+from|insert\s+into)\b/i,
  // Prototype pollution
  /__proto__\s*\[/i,
  /constructor\s*\[\s*['"]prototype['"]\s*\]/i,
];

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Recursively scan all string values in a JSON structure for unsafe patterns.
 * Returns the offending pattern string or null if clean.
 * @param {unknown} value
 * @returns {string|null}
 */
function findUnsafeString(value) {
  if (typeof value === "string") {
    for (const re of UNSAFE_PATTERNS) {
      if (re.test(value)) return re.source;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findUnsafeString(item);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) {
      const hit = findUnsafeString(v);
      if (hit) return hit;
    }
    return null;
  }
  return null;
}

// ── step functions ─────────────────────────────────────────────────────────────

/**
 * Step 1 — Structural: valid JSON + required keys.
 * @param {string} raw
 * @param {string[]} requiredKeys
 * @returns {{ ok: boolean, parsed?: unknown, reason?: string }}
 */
function stepStructural(raw, requiredKeys) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `Invalid JSON: ${e.message}` };
  }

  if (parsed === null || typeof parsed !== "object") {
    return { ok: false, reason: "AI response is not a JSON object." };
  }

  for (const key of requiredKeys) {
    if (!(key in parsed)) {
      return { ok: false, reason: `Missing required key: "${key}"` };
    }
  }

  return { ok: true, parsed };
}

/**
 * Step 2 — Type: verify that schema-defined array/object/string fields match.
 * @param {unknown} parsed
 * @param {Record<string,string>} typeExpectations  e.g. { testCases: "array", insights: "array" }
 * @returns {{ ok: boolean, reason?: string }}
 */
function stepTypeCheck(parsed, typeExpectations) {
  for (const [key, expectedType] of Object.entries(typeExpectations)) {
    if (!(key in parsed)) continue; // already caught by structural
    const actual = parsed[key];
    const actualType = Array.isArray(actual) ? "array" : typeof actual;
    if (actualType !== expectedType) {
      return {
        ok: false,
        reason: `Field "${key}" should be ${expectedType} but got ${actualType}.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Step 3 — Business logic: test cases must have id/name/steps/expected.
 * Applied only when the response includes a `testCases` array.
 * @param {unknown} parsed
 * @returns {{ ok: boolean, reason?: string }}
 */
function stepBusinessLogic(parsed) {
  let testCases = null;
  if (Array.isArray(parsed)) {
    testCases = parsed;
  } else if (Array.isArray(parsed?.testCases)) {
    testCases = parsed.testCases;
  } else {
    return { ok: true }; // not applicable
  }

  const REQUIRED_TC_FIELDS = ["id", "name", "steps", "expected", "comments"];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    if (!tc || typeof tc !== "object") {
      return { ok: false, reason: `testCases[${i}] is not an object.` };
    }
    for (const field of REQUIRED_TC_FIELDS) {
      if (tc[field] == null || (typeof tc[field] === "string" && tc[field].trim() === "")) {
        return {
          ok: false,
          reason: `testCases[${i}] is missing or has empty field: "${field}"`,
        };
      }
    }
    if (!Array.isArray(tc.steps) || tc.steps.length === 0) {
      return { ok: false, reason: `testCases[${i}].steps must be a non-empty array.` };
    }
  }
  return { ok: true };
}

/**
 * Step 4 — Safety: scan all string values for harmful patterns.
 * @param {unknown} parsed
 * @returns {{ ok: boolean, reason?: string }}
 */
function stepSafety(parsed) {
  const hit = findUnsafeString(parsed);
  if (hit) {
    return {
      ok: false,
      reason: `AI output contains potentially unsafe content matching pattern: ${hit}`,
    };
  }
  return { ok: true };
}

// ── sanitiser ─────────────────────────────────────────────────────────────────

/**
 * Recursively sanitise string values: trim whitespace and remove HTML tags.
 * Does NOT strip valid code — only markup that has no place in test data.
 * @param {unknown} value
 * @returns {unknown}
 */
export function sanitizeOutput(value) {
  if (typeof value === "string") {
    return value
      .replace(/<[^>]+>/g, "") // strip HTML tags
      .replace(/\r/g, "")      // normalise line endings
      .trim();
  }
  if (Array.isArray(value)) return value.map(sanitizeOutput);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitizeOutput(v)])
    );
  }
  return value;
}

// ── pipeline ──────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} ok
 * @property {unknown} [parsed]   — sanitised parsed value, present when ok=true
 * @property {string}  [step]     — failed step name
 * @property {string}  [reason]   — human-readable failure reason
 */

/**
 * @typedef {Object} SchemaDescriptor
 * @property {string[]} requiredKeys
 * @property {Record<string,string>} typeExpectations
 */

/** Default schema for all three endpoints. */
export const DEFAULT_SCHEMA = {
  requiredKeys: [],                 // overridden per-endpoint
  typeExpectations: {},
};

/** Schema for /generate-testcases */
export const TEST_CASES_SCHEMA = {
  requiredKeys: [],                 // top-level is an array, checked in formatter
  typeExpectations: {},
};

/** Schema for /generate-tests */
export const TEST_SCRIPT_SCHEMA = {
  requiredKeys: ["framework", "language", "filename"],
  typeExpectations: { framework: "string", language: "string", filename: "string" },
};

/** Schema for /analyze-failure */
export const FAILURE_SCHEMA = {
  requiredKeys: ["explanation", "possibleCauses", "suggestedFixes"],
  typeExpectations: {
    explanation: "string",
    possibleCauses: "array",
    suggestedFixes: "array",
  },
};

/**
 * Run the full four-step validation pipeline.
 * @param {string} raw   — raw AI output string
 * @param {SchemaDescriptor} schema
 * @returns {ValidationResult}
 */
export function runValidationPipeline(raw, schema) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, step: "structural", reason: "AI returned an empty response." };
  }

  // ── Step 1: Structural ────────────────────────────────────────────────────
  // For test cases the root may be an array — handle that specially
  let parsed;
  let structuralResult;

  const trimmed = raw.trim();
  const isArray = trimmed.startsWith("[");

  if (isArray && schema.requiredKeys.length === 0) {
    // Test cases: array-root response
    try {
      parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        return { ok: false, step: "structural", reason: "Expected a JSON array at root." };
      }
      structuralResult = { ok: true, parsed };
    } catch (e) {
      return { ok: false, step: "structural", reason: `Invalid JSON: ${e.message}` };
    }
  } else {
    structuralResult = stepStructural(trimmed, schema.requiredKeys);
    if (!structuralResult.ok) {
      logger.warn("validation_failed", { step: "structural", reason: structuralResult.reason });
      return { ok: false, step: "structural", reason: structuralResult.reason };
    }
    parsed = structuralResult.parsed;
  }

  // ── Step 2: Type ──────────────────────────────────────────────────────────
  if (!isArray) {
    const typeResult = stepTypeCheck(parsed, schema.typeExpectations);
    if (!typeResult.ok) {
      logger.warn("validation_failed", { step: "type", reason: typeResult.reason });
      return { ok: false, step: "type", reason: typeResult.reason };
    }
  }

  // ── Step 3: Business Logic ────────────────────────────────────────────────
  const bizResult = stepBusinessLogic(parsed);
  if (!bizResult.ok) {
    logger.warn("validation_failed", { step: "business", reason: bizResult.reason });
    return { ok: false, step: "business", reason: bizResult.reason };
  }

  // ── Step 4: Safety ────────────────────────────────────────────────────────
  const safetyResult = stepSafety(parsed);
  if (!safetyResult.ok) {
    logger.warn("validation_failed", { step: "safety", reason: safetyResult.reason });
    return { ok: false, step: "safety", reason: safetyResult.reason };
  }

  // All steps passed — sanitise and return
  const sanitised = sanitizeOutput(parsed);
  return { ok: true, parsed: sanitised };
}

/**
 * Convenience validator function for `completeWithRetry`.
 * Returns true only if the raw string passes Steps 1–2 (structural + type).
 * Business and safety checks happen after the formatter runs.
 * @param {SchemaDescriptor} schema
 * @returns {(raw: string) => boolean}
 */
export function makeQuickValidator(schema) {
  return function quickValidator(raw) {
    if (!raw || raw.trim().length === 0) return false;
    const result = runValidationPipeline(raw, schema);
    // Accept if structural is clean (steps 1–2); business/safety refined later
    return result.ok || result.step === "business" || result.step === "safety";
  };
}
