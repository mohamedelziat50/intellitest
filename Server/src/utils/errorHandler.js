/**
 * Shared HTTP error utilities for controllers.
 *
 * Centralises:
 *   - HTTP status code derivation from structured errors
 *   - Structured JSON error response emission
 *
 * Previously duplicated between inteliteController.js and generateController.js.
 */

import { server as serverConfig } from "../config.js";
import { buildFallbackResponse }  from "../ai/aiService.js";

/**
 * Map a structured error to an appropriate HTTP status code.
 * @param {{ source?: string, type?: string }} err
 * @returns {number}
 */
export function statusFromError(err) {
  if (err.type   === "RateLimitExceeded") return 429;
  if (err.source === "AI")               return 502;
  if (err.type   === "MissingConfig")    return 503;
  return 500;
}

/**
 * Send a structured error response, merging an optional safe fallback payload.
 *
 * @param {import("express").Response} res
 * @param {Error & { source?: string; type?: string }} err
 * @param {object} [fallback]  — safe fallback data returned alongside the error
 */
export function sendError(res, err, fallback = {}) {
  const payload = buildFallbackResponse(err);
  const status  = statusFromError(err);

  // Surface raw detail in development to accelerate debugging
  if (serverConfig.isDev && err.message) {
    payload.detail = err.message;
  }

  return res.status(status).json({ ...payload, ...fallback });
}
