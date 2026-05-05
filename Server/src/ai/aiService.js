/**
 * AI Service — wraps the LLM provider with:
 *   1. AbortController timeout
 *   2. Retry logic with correction prompt on invalid output
 *   3. Structured error classification (source: "AI" | "backend")
 *
 * All configuration is loaded once at module initialisation from config.js.
 * No process.env reads inside request-path code.
 */

import axios        from "axios";
import { ai as cfg } from "../config.js";
import { logTerminalSection, logger } from "../utils/logger.js";

// ── Error types ───────────────────────────────────────────────────────────────

export class AiError extends Error {
  /**
   * @param {"AI"|"backend"} source
   * @param {string} type
   * @param {string} message
   */
  constructor(source, type, message) {
    super(message);
    this.name   = "AiError";
    this.source = source;
    this.type   = type;
  }
}

export function buildErrorPayload(source, type, message, detail) {
  return { source, type, message, ...(detail !== undefined ? { detail } : {}) };
}

// ── Provider adapters ─────────────────────────────────────────────────────────

/**
 * Single call to the Ollama local inference server.
 * @param {string} prompt
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
 */
async function callOllama(prompt, signal) {
  const url  = `${cfg.ollamaBase.replace(/\/$/, "")}/api/chat`;
  const body = {
    model:    cfg.ollamaModel,
    messages: [{ role: "user", content: prompt }],
    stream:   false,
  };

  try {
    const { data } = await axios.post(url, body, {
      signal,
      timeout: cfg.timeoutMs + 5_000, // axios hard cap slightly above abort timeout
    });
    const text = data?.message?.content ?? data?.response ?? "";
    return typeof text === "string" ? text : JSON.stringify(text);
  } catch (e) {
    if (e.name === "AbortError" || e.code === "ERR_CANCELED") {
      throw new AiError("AI", "Timeout", "Ollama request timed out.");
    }
    logger.error("ollama_call_failed", { message: e.message, url });
    throw new AiError("AI", "ProviderError", `Ollama request failed: ${e.message}`);
  }
}

/**
 * Single call to an OpenAI-compatible HTTP API (Groq, OpenAI, etc.).
 * @param {string} prompt
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
 */
async function callOpenAICompatible(prompt, signal) {
  if (!cfg.apiBase || !cfg.apiKey) {
    throw new AiError(
      "backend",
      "MissingConfig",
      "API_BASE_URL and API_KEY are required when LLM_PROVIDER=api"
    );
  }

  const url  = `${cfg.apiBase.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model:       cfg.apiModel,
    messages:    [{ role: "user", content: prompt }],
    temperature: 0.2,
  };

  try {
    const { data } = await axios.post(url, body, {
      signal,
      timeout: cfg.timeoutMs + 5_000,
      headers: {
        Authorization:  `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    const choice = data?.choices?.[0]?.message?.content;
    return typeof choice === "string" ? choice : JSON.stringify(choice ?? "");
  } catch (e) {
    if (e.name === "AbortError" || e.code === "ERR_CANCELED") {
      throw new AiError("AI", "Timeout", "AI API request timed out.");
    }
    const status   = e.response?.status;
    const bodyData = e.response?.data;
    const apiHint  = extractApiErrorMessage(bodyData);
    const detail   = apiHint || e.message;

    logger.error("api_call_failed", { message: detail, status });
    throw new AiError(
      "AI",
      "ProviderError",
      apiHint
        ? `LLM API error (${status ?? "?"}): ${apiHint}`
        : `LLM API request failed: ${e.message}`
    );
  }
}

/** Extract a human-readable error string from a provider error response body. */
function extractApiErrorMessage(body) {
  if (!body || typeof body !== "object") return "";
  const err = body.error;
  if (typeof err === "string")                 return err;
  if (err && typeof err.message === "string")  return err.message;
  if (typeof body.message === "string")        return body.message;
  return "";
}

// ── Provider dispatcher ───────────────────────────────────────────────────────

/**
 * Dispatch a single prompt to the configured provider.
 * Returns the raw text response.
 *
 * @param {string} prompt
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
 */
function callProvider(prompt, signal) {
  return cfg.provider === "api"
    ? callOpenAICompatible(prompt, signal)
    : callOllama(prompt, signal);
}

// ── Timeout wrapper ───────────────────────────────────────────────────────────

/**
 * Run `fn(signal)` with an AbortController timeout.
 * @param {(signal: AbortSignal) => Promise<string>} fn
 * @param {number} ms
 * @returns {Promise<string>}
 */
async function withTimeout(fn, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw new AiError("AI", "UnexpectedError", err.message);
  } finally {
    clearTimeout(timer);
  }
}

// ── Retry with correction ─────────────────────────────────────────────────────

const CORRECTION_PREFIX =
  "The previous response was malformed. Fix the JSON structure and follow the required schema strictly.\n\n";

/**
 * Attempt `fn` up to `maxRetries + 1` times.
 * On each failed validation, injects a correction prefix into the next prompt.
 *
 * @param {(prompt: string) => Promise<string>} fn
 * @param {string} initialPrompt
 * @param {(raw: string) => boolean} validator
 * @param {{ maxRetries?: number, correctionPrompt?: string }} [opts]
 * @returns {Promise<string>}
 */
export async function completeWithRetry(fn, initialPrompt, validator, opts = {}) {
  const maxRetries     = opts.maxRetries      ?? cfg.maxRetries;
  const correctionPfx  = opts.correctionPrompt ?? CORRECTION_PREFIX;

  let prompt    = initialPrompt;
  let lastRaw   = "";
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const raw = await fn(prompt);
      lastRaw = raw;

      if (validator(raw)) {
        if (attempt > 0) logger.info("ai_retry_succeeded", { attempt });
        return raw;
      }

      logger.warn("ai_output_invalid", { attempt, preview: raw.slice(0, 200) });

      if (attempt < maxRetries) {
        prompt = `${correctionPfx}Previous bad response:\n${raw.slice(0, 800)}\n\nOriginal instruction:\n${initialPrompt}`;
      }
    } catch (err) {
      lastError = err;
      logger.warn("ai_attempt_failed", { attempt, type: err.type ?? err.name, message: err.message });

      // These error categories won't resolve on retry — throw immediately
      if (err instanceof AiError && (err.type === "Timeout" || err.type === "MissingConfig")) {
        throw err;
      }

      if (attempt === maxRetries) break;
    }
  }

  if (lastError) throw lastError;

  throw new AiError(
    "AI",
    "InvalidResponse",
    `Model returned malformed output after ${maxRetries + 1} attempt(s).`
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Primary entry-point used by controllers.
 *
 * @param {string} prompt
 * @param {{ validator?: (raw: string) => boolean, correctionPrompt?: string, maxRetries?: number }} [opts]
 * @returns {Promise<string>} raw model text
 */
export async function complete(prompt, opts = {}) {
  logTerminalSection("AI → prompt", prompt);

  const validator = opts.validator ?? (() => true);

  try {
    const raw = await completeWithRetry(
      (p) => withTimeout((signal) => callProvider(p, signal), cfg.timeoutMs),
      prompt,
      (r) => typeof r === "string" && r.trim().length > 0 && validator(r),
      opts
    );

    logTerminalSection("AI → raw output", raw);
    return raw;
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw new AiError("backend", "UnexpectedError", err.message);
  }
}

/**
 * Build a standardised fallback payload from an AiError or generic Error.
 * @param {AiError|Error} err
 * @returns {{ source: string, type: string, message: string }}
 */
export function buildFallbackResponse(err) {
  if (err instanceof AiError) {
    if (err.type === "Timeout") {
      return buildErrorPayload("AI", "Timeout", "AI request timed out. Please try again.");
    }
    return buildErrorPayload(err.source, err.type, err.message);
  }
  return buildErrorPayload("backend", "UnexpectedError", "An unexpected error occurred.");
}
