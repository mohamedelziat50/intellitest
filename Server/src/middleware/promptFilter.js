/**
 * Prompt Filter middleware — applied to endpoints that accept a free-text
 * "prompt" field inside the project map.
 *
 * Goals
 * ------
 * 1. Reject clearly irrelevant / low-quality prompts (greetings, random text).
 * 2. Normalise and sanitise the prompt text that reaches the AI.
 * 3. Never block a legitimate technical request.
 *
 * Strategy (heuristic — no external NLP dependency)
 * ---------------------------------------------------
 * - Minimum meaningful-word threshold
 * - Greeting / social-phrase blocklist
 * - Technical-signal keyword boost (test, api, auth, route …)
 * - Entropy check to catch pure random character strings
 */

import { logger } from "../utils/logger.js";

// ── tunables ─────────────────────────────────────────────────────────────────
const MIN_PROMPT_CHARS = 4;        // below this → always reject
const MIN_MEANINGFUL_WORDS = 2;   // after stop-word removal
const TECHNICAL_BOOST_THRESHOLD = 1; // at least 1 technical keyword → always pass

// ── blocklists ────────────────────────────────────────────────────────────────
const GREETING_PATTERNS = [
  /^\s*(hello|hi|hey|howdy|greetings|what'?s up|good\s+(morning|afternoon|evening|day))\b/i,
  /^\s*(thanks?|thank you|thx|ty)\b/i,
  /^\s*(bye|goodbye|see ya|cya|later)\b/i,
  /^\s*(who are you|what are you|are you (an? )?ai)\b/i,
  /^\s*(how are you|how'?re you)\b/i,
];

const TECHNICAL_KEYWORDS = new Set([
  "test", "tests", "testing", "spec", "case", "cases", "scenario", "scenarios",
  "api", "route", "routes", "endpoint", "module", "modules", "auth", "login",
  "logout", "register", "checkout", "cart", "order", "payment", "user", "admin",
  "function", "method", "class", "component", "service", "controller", "model",
  "database", "db", "query", "mutation", "request", "response", "error", "fail",
  "crash", "bug", "exception", "validate", "validation", "input", "output",
  "unit", "integration", "e2e", "smoke", "regression", "functional",
  "edge", "boundary", "negative", "positive", "happy", "path",
]);

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "i", "me", "my", "you", "your", "it", "its", "we", "our", "they", "their",
  "this", "that", "these", "those", "can", "could", "should", "would", "will",
  "do", "does", "did", "have", "has", "had", "not", "no", "yes", "please",
]);

// ── helpers ────────────────────────────────────────────────────────────────────

/**
 * Rough Shannon entropy of a string (0–8 bits per character).
 * Strings of pure random characters have entropy ≥ ~4.
 * Normal English sentences are typically ≤ 3.5.
 */
function shannonEntropy(str) {
  const freq = {};
  for (const ch of str) freq[ch] = (freq[ch] ?? 0) + 1;
  const len = str.length;
  return Object.values(freq).reduce((sum, count) => {
    const p = count / len;
    return sum - p * Math.log2(p);
  }, 0);
}

/**
 * Tokenise by splitting on whitespace + punctuation, lowercase, filter short tokens.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * Count meaningful words (non-stop-words).
 * @param {string[]} tokens
 * @returns {number}
 */
function meaningfulWordCount(tokens) {
  return tokens.filter((t) => !STOP_WORDS.has(t)).length;
}

/**
 * Count technical keywords present in the token list.
 * @param {string[]} tokens
 * @returns {number}
 */
function technicalSignalCount(tokens) {
  return tokens.filter((t) => TECHNICAL_KEYWORDS.has(t)).length;
}

/**
 * Lightweight normalisation applied to every prompt that passes the filter.
 *  - Collapse excess whitespace / newlines
 *  - Strip leading/trailing punctuation noise
 *  - Preserve full technical identifiers
 * @param {string} text
 * @returns {string}
 */
function normalizePrompt(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[\s\W]+/, "")
    .replace(/[\s\W]+$/, "")
    .trim();
}

/**
 * Core quality check. Returns { pass: boolean, reason?: string }.
 * @param {string} prompt
 * @returns {{ pass: boolean, reason?: string }}
 */
function assessPromptQuality(prompt) {
  if (prompt.length < MIN_PROMPT_CHARS) {
    return { pass: false, reason: "Prompt is too short to be meaningful." };
  }

  // Greeting / social phrase check
  for (const pattern of GREETING_PATTERNS) {
    if (pattern.test(prompt)) {
      return {
        pass: false,
        reason:
          "IntelliTest is a software testing tool. Please describe what you'd like to test " +
          "(e.g. 'Generate test cases for the login API endpoint').",
      };
    }
  }

  const tokens = tokenize(prompt);
  const technical = technicalSignalCount(tokens);

  // Any technical keyword → pass immediately
  if (technical >= TECHNICAL_BOOST_THRESHOLD) {
    return { pass: true };
  }

  const meaningful = meaningfulWordCount(tokens);

  // Entropy check for random gibberish
  const entropy = shannonEntropy(prompt.toLowerCase());
  if (entropy > 4.5 && meaningful < 1) {
    return {
      pass: false,
      reason: "The prompt appears to contain random text. Please describe a testing scenario.",
    };
  }
  if (meaningful < MIN_MEANINGFUL_WORDS) {
    return {
      pass: false,
      reason:
        "Your prompt seems too vague. Try something like: " +
        "'Test the checkout flow for missing address fields'.",
    };
  }

  return { pass: true };
}

// ── middleware ─────────────────────────────────────────────────────────────────

/**
 * Express middleware. Applies only when `req.projectMap.prompt` is non-empty.
 * Empty prompts are allowed (they just won't have a tester-ask section).
 */
export function promptFilter(req, res, next) {
  const raw = req.projectMap?.prompt;

  // No prompt supplied — nothing to filter
  if (!raw || String(raw).trim() === "") return next();

  const prompt = String(raw).trim();
  const { pass, reason } = assessPromptQuality(prompt);

  if (!pass) {
    logger.warn("prompt_rejected", { prompt: prompt.slice(0, 120), reason });
    return res.status(422).json({
      source: "backend",
      type: "InvalidPrompt",
      message: reason,
    });
  }

  // Write normalised version back so downstream services get clean input
  req.projectMap.prompt = normalizePrompt(prompt);
  next();
}
