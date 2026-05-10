/**
 * POST /generate-test-code
 * Builds executable test code from the prior POST /generate JSON payload (or Excel-derived equivalent).
 */

import * as promptService from "../services/promptService.js";
import { complete, buildFallbackResponse } from "../ai/aiService.js";
import { sendError } from "../utils/errorHandler.js";
import { logger } from "../utils/logger.js";

function stripMarkdownFences(text) {
  return String(text ?? "")
    .replace(/^```[\w]*\r?\n?/m, "")
    .replace(/\r?\n?```$/m, "")
    .trim();
}

/**
 * @type {import("express").RequestHandler}
 */
export async function generateTestCode(req, res) {
  const { framework, generateResponsePayload } = req.generateTestCodeBody;

  try {
    const prompt = promptService.generateExecutableTestCodePrompt(framework, generateResponsePayload);
    const raw = await complete(prompt);
    const code = stripMarkdownFences(raw);

    if (!code) {
      return res.status(502).json({
        ...buildFallbackResponse(new Error("Empty model output")),
        code: "",
      });
    }

    return res.json({ code });
  } catch (err) {
    logger.error("generate_test_code_failed", { message: err.message });
    return sendError(res, err, { code: "" });
  }
}
