/**
 * Sliding-window rate limiter (in-memory, no external deps).
 *
 * Algorithm:
 *   Per key, maintain an array of request timestamps.
 *   On each request:
 *     1. Prune timestamps older than windowMs.
 *     2. If count >= max → 429.
 *     3. Otherwise record timestamp and continue.
 *
 * Configuration is read from config.js (RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX).
 * For multi-process deployments swap the in-process Map for a Redis store.
 *
 * Key derivation:
 *   X-Forwarded-For (first IP) → socket.remoteAddress → "unknown"
 */

import { rateLimit as cfg } from "../config.js";
import { logger } from "../utils/logger.js";

/** @type {Map<string, number[]>} */
const store = new Map();

// ── helpers ────────────────────────────────────────────────────────────────────

function prune(timestamps, now, windowMs) {
  const cutoff = now - windowMs;
  return timestamps.filter((t) => t > cutoff);
}

function getKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

/** Periodic housekeeping — removes stale keys to prevent memory leaks. */
function maybePurge(now, windowMs) {
  if (Math.random() > 0.01) return;
  const cutoff = now - windowMs;
  for (const [k, ts] of store.entries()) {
    if (ts.every((t) => t <= cutoff)) store.delete(k);
  }
}

// ── factory ───────────────────────────────────────────────────────────────────

/**
 * Create a rate-limiter middleware instance.
 *
 * @param {{ windowMs?: number, max?: number }} [options]
 * @returns {import("express").RequestHandler}
 */
export function createRateLimiter({ windowMs = cfg.windowMs, max = cfg.max } = {}) {
  return function rateLimiterMiddleware(req, res, next) {
    const key = getKey(req);
    const now = Date.now();

    const pruned    = prune(store.get(key) ?? [], now, windowMs);
    const remaining = max - pruned.length;

    // Informational headers (RFC 6585 compatible)
    res.setHeader("X-RateLimit-Limit",     max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, remaining - 1));
    res.setHeader("X-RateLimit-Window-Ms", windowMs);

    if (remaining <= 0) {
      const oldest  = pruned[0];
      const resetAt = new Date(oldest + windowMs).toISOString();
      res.setHeader("Retry-After", Math.ceil((oldest + windowMs - now) / 1000));

      logger.warn("rate_limit_exceeded", { key, count: pruned.length, max });

      return res.status(429).json({
        source:     "backend",
        type:       "RateLimitExceeded",
        message:    `Too many requests — ${max} allowed per ${windowMs / 1000}s window.`,
        retryAfter: resetAt,
      });
    }

    pruned.push(now);
    store.set(key, pruned);
    maybePurge(now, windowMs);

    next();
  };
}

/** Default export — singleton configured from env via config.js. */
export const rateLimiter = createRateLimiter();
