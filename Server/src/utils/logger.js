/**
 * Structured logger — reads configuration from config.js (single source of truth).
 * Drop-in replaceable with pino/winston without changing call sites.
 */

import { log } from "../config.js";

function ts() {
  return new Date().toISOString();
}

function truncate(text, max = log.maxSectionChars) {
  if (text == null) return "";
  const s = typeof text === "string" ? text : JSON.stringify(text, null, 2);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… [truncated ${s.length - max} chars — raise LOG_MAX_SECTION_CHARS to show more]`;
}

/**
 * Readable bordered sections in the server terminal.
 * Used for logging raw extension payloads, AI prompts, and model output.
 */
export function logTerminalSection(title, content) {
  const body = truncate(content);
  console.log(`\n────────── ${title} ──────────`);
  console.log(body);
  console.log(`────────── end: ${title} ──────────\n`);
}

export const logger = {
  info(message, meta = {}) {
    if (log.level === "silent") return;
    console.log(JSON.stringify({ level: "info", time: ts(), message, ...meta }));
  },
  warn(message, meta = {}) {
    if (log.level === "silent") return;
    console.warn(JSON.stringify({ level: "warn", time: ts(), message, ...meta }));
  },
  error(message, meta = {}) {
    console.error(JSON.stringify({ level: "error", time: ts(), message, ...meta }));
  },
  debug(message, meta = {}) {
    if (log.level !== "debug") return;
    console.log(JSON.stringify({ level: "debug", time: ts(), message, ...meta }));
  },
};
