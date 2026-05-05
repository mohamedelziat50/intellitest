import { Router } from "express";

// ── controllers ────────────────────────────────────────────────────────────────
import * as inteliteController from "../controllers/inteliteController.js";
import { generate }     from "../controllers/generateController.js";
import { initProject }  from "../controllers/projectController.js";

// ── middleware ─────────────────────────────────────────────────────────────────
import { validateProjectMap, validateAnalyzeFailure } from "../middleware/validateBody.js";
import { validateGenerate } from "../middleware/validateGenerate.js";
import { promptFilter }     from "../middleware/promptFilter.js";

const router = Router();

// ── New stateful endpoints ─────────────────────────────────────────────────────

/**
 * POST /generate
 * Unified stateful endpoint: project upsert → context merge → AI → persist → respond.
 */
router.post(
  "/generate",
  validateGenerate,
  promptFilter,
  generate
);

/**
 * GET /project/:projectId/init
 * Called by extension on load: returns chat history, context, and features.
 */
router.get("/project/:projectId/init", initProject);

// ── Legacy endpoints (unchanged) ──────────────────────────────────────────────
// These are kept for backwards compatibility with the current extension.

router.post(
  "/generate-testcases",
  validateProjectMap,
  promptFilter,
  inteliteController.generateTestCases
);

router.post(
  "/generate-tests",
  validateProjectMap,
  promptFilter,
  inteliteController.generateTests
);

router.post(
  "/analyze-failure",
  validateAnalyzeFailure,
  inteliteController.analyzeFailure
);

export default router;
