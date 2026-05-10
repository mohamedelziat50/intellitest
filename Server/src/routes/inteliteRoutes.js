import { Router } from "express";

// ── controllers ────────────────────────────────────────────────────────────────
import * as inteliteController from "../controllers/inteliteController.js";
import * as testCodeController from "../controllers/testCodeController.js";
import { generate, analyzeIntent }     from "../controllers/generateController.js";
import { initProject, syncProject }  from "../controllers/projectController.js";

// ── middleware ─────────────────────────────────────────────────────────────────
import {
  validateProjectMap,
  validateAnalyzeFailure,
  validateGenerateTestCode,
} from "../middleware/validateBody.js";
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
 * POST /analyze-intent
 * Pre-flight check to filter context and find features before full generation
 */
router.post(
  "/analyze-intent",
  analyzeIntent
);

/**
 * POST /generate-test-code
 * Builds automation code from the prior POST /generate JSON (JWT not required).
 */
router.post("/generate-test-code", validateGenerateTestCode, testCodeController.generateTestCode);

/**
 * GET /project/:projectId/init
 * Called by extension on load: returns chat history, context, and features.
 */
router.get("/project/:projectId/init", initProject);

/**
 * POST /project/:projectId/sync
 * Called by extension on load or reset: sends all 1000+ files to build the 
 * Global Intelligence Graph (Features & Relationships) in MongoDB.
 */
router.post("/project/:projectId/sync", syncProject);

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
