/**
 * Parses LLM text into structured JSON. Handles fenced code blocks and loose JSON.
 */

/**
 * Strip markdown ```json ... ``` wrappers and trim.
 */
export function extractJsonString(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.trim();
  const fenceLoose = /```(?:json)?\s*\n?([\s\S]*?)\n?```/im;
  const fm = s.match(fenceLoose);
  if (fm) s = fm[1].trim();
  const start = s.indexOf("[");
  const startObj = s.indexOf("{");
  let from = -1;
  if (start >= 0 && (startObj < 0 || start < startObj)) from = start;
  else if (startObj >= 0) from = startObj;
  if (from > 0) s = s.slice(from);
  return s.trim();
}

/**
 * Parse JSON array safely; returns [] on failure.
 */
export function parseTestCasesArray(raw) {
  const s = extractJsonString(raw);
  try {
    const data = JSON.parse(s);
    if (Array.isArray(data)) return normalizeTestCases(data);
    if (data && Array.isArray(data.testCases)) return normalizeTestCases(data.testCases);
    return [];
  } catch {
    return [];
  }
}

function normalizePreconditions(value) {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean).join("; ");
  }
  return value != null ? String(value) : "";
}

function normalizeTestCases(items) {
  return items.map((tc, i) => ({
    id: String(tc.id ?? `TC-${String(i + 1).padStart(3, "0")}`),
    name: String(tc.name ?? "Unnamed test"),
    description: tc.description != null ? String(tc.description) : "",
    preconditions: normalizePreconditions(tc.preconditions),
    steps: Array.isArray(tc.steps) ? tc.steps.map(String) : [],
    expected: tc.expected != null ? String(tc.expected) : "",
    priority: tc.priority != null ? String(tc.priority) : undefined,
    tags: Array.isArray(tc.tags) ? tc.tags.map(String) : undefined,
  }));
}

/**
 * Join codeLines or normalize "code" string (handles literal \\n from some models).
 */
function normalizeScriptCode(script) {
  if (script && Array.isArray(script.codeLines) && script.codeLines.length > 0) {
    return script.codeLines.map((line) => String(line ?? "")).join("\n");
  }
  const c = script?.code;
  if (typeof c !== "string") return "";
  return c.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

/**
 * Parse generated test script object: { framework, language, filename, code | codeLines }.
 */
export function parseTestScript(raw) {
  const s = extractJsonString(raw);
  try {
    const data = JSON.parse(s);
    const script = data.script ?? data;
    const code = normalizeScriptCode(script);
    return {
      framework: String(script.framework ?? "jest"),
      language: String(script.language ?? "javascript"),
      filename: String(script.filename ?? "generated.test.js"),
      code,
    };
  } catch {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    const looksLikeDump =
      trimmed.startsWith("```") ||
      (trimmed.includes('"code"') && trimmed.includes("{") && trimmed.length > 800);
    return {
      framework: "jest",
      language: "javascript",
      filename: "generated.test.js",
      code: looksLikeDump
        ? [
            "// Could not parse the model response as JSON.",
            "// Regenerate, or ask the server prompt to return only valid JSON with a \"codeLines\" array (one string per line).",
            "",
            "--- raw response (trimmed) ---",
            trimmed.slice(0, 4000) + (trimmed.length > 4000 ? "\n...[truncated]" : ""),
          ].join("\n")
        : trimmed,
    };
  }
}

/**
 * Parse failure analysis: explanation, possibleCauses, suggestedFixes.
 */
export function parseFailureAnalysis(raw) {
  const s = extractJsonString(raw);
  try {
    const data = JSON.parse(s);
    return {
      explanation: String(data.explanation ?? ""),
      possibleCauses: Array.isArray(data.possibleCauses)
        ? data.possibleCauses.map(String)
        : [],
      suggestedFixes: Array.isArray(data.suggestedFixes)
        ? data.suggestedFixes.map(String)
        : [],
    };
  } catch {
    return {
      explanation: raw?.trim()?.slice(0, 2000) || "Could not parse structured analysis.",
      possibleCauses: [],
      suggestedFixes: [],
    };
  }
}
