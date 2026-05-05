/**
 * IntelliTest Legacy Controllers
 *
 * Handles the original three endpoints:
 *   POST /generate-testcases
 *   POST /generate-tests
 *   POST /analyze-failure
 *
 * Each handler follows the same linear flow:
 *   1. Log incoming payload
 *   2. Build prompt via promptService
 *   3. Call aiService.complete() — timeout + retry handled internally
 *   4. Run output through the 4-step validation pipeline
 *   5. Parse / normalise via formatter
 *   6. Return structured JSON
 *
 * Error shape: always { source, type, message } — sourced from errorHandler.js.
 */

import * as promptService from "../services/promptService.js";
import * as formatter     from "../utils/formatter.js";
import { logTerminalSection, logger } from "../utils/logger.js";
import { complete }       from "../ai/aiService.js";
import { sendError }      from "../utils/errorHandler.js";
import {
  runValidationPipeline,
  makeQuickValidator,
  TEST_CASES_SCHEMA,
  TEST_SCRIPT_SCHEMA,
  FAILURE_SCHEMA,
} from "../validators/outputValidator.js";

// ── Safe fallbacks ────────────────────────────────────────────────────────────

const FALLBACK_TEST_CASES = Object.freeze({
  testCases: [],
  meta: { fallback: true, message: "AI could not produce valid test cases. Please try again." },
});

const FALLBACK_SCRIPT = Object.freeze({
  script: {
    framework: "jest",
    language:  "javascript",
    filename:  "generated.test.js",
    code:      "// AI could not produce a valid test script. Please try again.",
  },
  meta: { fallback: true },
});

const FALLBACK_ANALYSIS = Object.freeze({
  analysis: {
    explanation:    "AI could not produce a valid failure analysis. Please try again.",
    possibleCauses: [],
    suggestedFixes: [],
  },
  meta: { fallback: true },
});

// ── Controllers ───────────────────────────────────────────────────────────────

/** POST /generate-testcases */
export async function generateTestCases(req, res) {
  try {
    logTerminalSection("POST /generate-testcases — payload", req.projectMap ?? req.body);

    const prompt     = promptService.generateTestCasesPrompt(req.projectMap);
    const raw        = await complete(prompt, { validator: makeQuickValidator(TEST_CASES_SCHEMA) });
    const validation = runValidationPipeline(raw, TEST_CASES_SCHEMA);

    if (!validation.ok) {
      logger.warn("generate_testcases_validation_failed", { reason: validation.reason });
    }

    const testCases = formatter.parseTestCasesArray(raw);
    logger.info("generate_testcases_ok", { count: testCases.length });
    return res.json({ testCases });

  } catch (err) {
    logger.error("generate_testcases_failed", { message: err.message });
    return sendError(res, err, FALLBACK_TEST_CASES);
  }
}

/** POST /generate-tests */
export async function generateTests(req, res) {
  try {
    logTerminalSection("POST /generate-tests — payload", req.projectMap ?? req.body);

    const prompt     = promptService.generateTestScriptsPrompt(req.projectMap);
    const raw        = await complete(prompt, { validator: makeQuickValidator(TEST_SCRIPT_SCHEMA) });
    const validation = runValidationPipeline(raw, TEST_SCRIPT_SCHEMA);

    if (!validation.ok) {
      logger.warn("generate_tests_validation_failed", { reason: validation.reason });
    }

    const script = formatter.parseTestScript(raw);
    logger.info("generate_tests_ok", { framework: script.framework });
    return res.json({ script });

  } catch (err) {
    logger.error("generate_tests_failed", { message: err.message });
    return sendError(res, err, FALLBACK_SCRIPT);
  }
}

/** POST /analyze-failure */
export async function analyzeFailure(req, res) {
  try {
    logTerminalSection("POST /analyze-failure — payload", req.failurePayload ?? req.body);

    const prompt     = promptService.analyzeFailurePrompt(req.failurePayload);
    const raw        = await complete(prompt, { validator: makeQuickValidator(FAILURE_SCHEMA) });
    const validation = runValidationPipeline(raw, FAILURE_SCHEMA);

    if (!validation.ok) {
      logger.warn("analyze_failure_validation_failed", { reason: validation.reason });
    }

    const analysis = formatter.parseFailureAnalysis(raw);
    logger.info("analyze_failure_ok");
    return res.json({ analysis });

  } catch (err) {
    logger.error("analyze_failure_failed", { message: err.message });
    return sendError(res, err, FALLBACK_ANALYSIS);
  }
}
