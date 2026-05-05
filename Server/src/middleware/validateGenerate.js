/**
 * validateGenerate middleware
 *
 * Validates and normalises the request body for POST /generate.
 * On success, attaches:
 *   req.projectId   — sanitised project identifier (string)
 *   req.projectMap  — normalised project map (same shape as validateProjectMap)
 *
 * projectId format (matches server-side regex):
 *   alphanumeric, hyphen, underscore, dot — 6 to 128 characters.
 *   Covers UUID v4 and SHA-256 hex hashes.
 */

import { toStr } from "../utils/helpers.js";

/** Regex that also enforces the projectId format on the server side. */
const PROJECT_ID_RE = /^[a-zA-Z0-9\-_.]{6,128}$/;

export function validateGenerate(req, res, next) {
  const b = req.body;

  if (!b || typeof b !== "object") {
    return res.status(400).json({
      source:  "backend",
      type:    "ValidationError",
      message: "Request body must be a JSON object.",
    });
  }

  // ── projectId ────────────────────────────────────────────────────────────
  const rawId = b.projectId;
  if (!rawId || typeof rawId !== "string" || !PROJECT_ID_RE.test(rawId.trim())) {
    return res.status(400).json({
      source:  "backend",
      type:    "ValidationError",
      message: "Field 'projectId' is required and must be a 6–128 character alphanumeric/UUID string.",
    });
  }
  req.projectId = rawId.trim();

  // ── projectMap ────────────────────────────────────────────────────────────
  // Accept either:
  //   a) all fields at the top level (flat body)
  //   b) fields nested under body.projectMap
  const raw = (typeof b.projectMap === "object" && b.projectMap !== null)
    ? b.projectMap
    : b;

  for (const k of ["type", "language", "framework"]) {
    if (raw[k] == null || String(raw[k]).trim() === "") {
      return res.status(400).json({
        source:  "backend",
        type:    "ValidationError",
        message: `Missing or empty required field: '${k}'`,
      });
    }
  }

  req.projectMap = {
    type:          toStr(raw.type),
    language:      toStr(raw.language),
    framework:     toStr(raw.framework),
    name:          raw.name ? toStr(raw.name) : undefined,
    modules:       Array.isArray(raw.modules)       ? raw.modules.map(String)       : [],
    routes:        Array.isArray(raw.routes)         ? raw.routes.map(String)        : [],
    priorityFiles: Array.isArray(raw.priorityFiles)  ? raw.priorityFiles.map(String) : [],
    codeInsights:  (raw.codeInsights && typeof raw.codeInsights === "object")
      ? raw.codeInsights
      : {},
    testCases:     Array.isArray(raw.testCases) ? raw.testCases.slice(0, 50) : [],
    prompt:        toStr(raw.prompt),
  };

  next();
}
