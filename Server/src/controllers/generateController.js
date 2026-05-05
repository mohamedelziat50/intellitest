/**
 * Generate Controller — POST /generate
 *
 * Responsibility: orchestrate the generation flow.
 * All business logic lives in dedicated services.
 *
 * Flow:
 *   1. Upsert project + merge context (parallel DB writes)
 *   2. Enrich projectMap with accumulated context
 *   3. Build AI prompt
 *   4. Call AI with timeout + retry
 *   5. Validate response (4-step pipeline)
 *   6. Parse output
 *   7. Persist message + generation record (parallel)
 *   8. Upsert features
 *   9. Return structured response
 */

import * as promptService  from "../services/promptService.js";
import * as projectService from "../services/projectService.js";
import * as contextService from "../services/contextService.js";
import * as guardrailService from "../services/guardrailService.js";
import { extractFeatures, buildFeatureRelationships } from "../services/featureExtractionService.js";
import { mapPromptToFeatures } from "../services/featureMappingEngine.js";
import { calculateCoverage } from "../services/coverageEngine.js";
import * as formatter      from "../utils/formatter.js";
import { logTerminalSection, logger } from "../utils/logger.js";
import { complete }        from "../ai/aiService.js";
import { sendError }       from "../utils/errorHandler.js";
import {
  runValidationPipeline,
  makeQuickValidator,
  TEST_CASES_SCHEMA,
} from "../validators/outputValidator.js";

// ── Safe fallback (returned alongside error payloads) ─────────────────────────

const FALLBACK_GENERATE = Object.freeze({
  testCases:   [],
  scripts:     null,
  insights:    [],
  suggestions: [],
  meta: { fallback: true, message: "AI could not produce valid output. Please try again." },
});

// ── Controller ─────────────────────────────────────────────────────────────────

/**
 * POST /generate
 * @type {import("express").RequestHandler}
 */
export async function generate(req, res) {
  const startMs    = Date.now();
  const userId     = req.userId || req.user?.id; // extracted from authMiddleware
  const projectId  = req.projectId;          // set by validateGenerate
  const projectMap = req.projectMap;          // set by validateGenerate
  const userPrompt = projectMap.prompt ?? "";

  logTerminalSection("POST /generate — userId", userId);
  logTerminalSection("POST /generate — projectId", projectId);
  logTerminalSection("POST /generate — projectMap", projectMap);

  // Mutable state scoped to this request — used in both success + error paths
  let rawAiOutput      = "";
  let retryCount       = 0;
  let aiStatus         = "ok";
  let validationErrors = [];

  try {
    // ── Step 1: Upsert project + merge context (parallel) ────────────────────
    let context = null;
    if (userId) {
      const [, ctx] = await Promise.all([
        projectService.upsertProject(userId, projectId, projectMap),
        projectService.mergeContext(userId, projectId, projectMap),
      ]);
      context = ctx;
    }

    // ── Step 2: Enrich projectMap with stored context ─────────────────────────
    const enrichedMap = contextService.enrichProjectMap(projectMap, context);

    // ── Step 2.1: Clean Context ───────────────────────────────────────────────
    const cleanedMap = contextService.cleanContext(enrichedMap);

    // ── Step 2.2: Extract Features & Sync to MongoDB ─────────────────────────
    const extractedFeatures = extractFeatures(cleanedMap, projectId);
    const relationships = buildFeatureRelationships(extractedFeatures, projectId);
    
    if (userId) {
      await projectService.syncFeatureIntelligence(userId, projectId, extractedFeatures, relationships);
    }
    const allowedFeatures = extractedFeatures.map(f => f.normalizedName);

    // ── Step 2.5: Guardrail Decision Layer (Feature Intelligence) ─────────────
    const matchResult = mapPromptToFeatures(userPrompt, extractedFeatures, relationships);
    
    let decision = "allowed";
    if (userPrompt.trim().length > 0) {
      decision = matchResult.matchType;
    }

    let coverageMap = {};
    if (userId && matchResult.matchedFeatures.length > 0) {
      const coverages = await projectService.loadFeatureCoverage(userId, projectId, matchResult.matchedFeatures);
      for (const c of coverages) {
        coverageMap[c.feature] = c;
      }
    }

    logger.info("feature_mapping", {
      event: "feature_mapping",
      prompt: userPrompt,
      extractedFeatures: allowedFeatures,
      matchedFeatures: matchResult.matchedFeatures,
      relatedFeatures: matchResult.relatedFeatures,
      coverage: coverageMap,
      confidence: matchResult.confidence,
      decision: decision === "none" ? "fallback" : decision
    });

    // ❌ REMOVED HARD BLOCKING, replaced with Fallback
    if (decision === "none" && userPrompt.trim().length > 0) {
      return res.json({
        warning: "Feature not found",
        suggestions: matchResult.relatedFeatures.length > 0 ? matchResult.relatedFeatures.slice(0, 2) : ["product", "collection"],
        closestFlows: matchResult.closestFlows,
        action: "fallback",
        features: []
      });
    }

    // ── Step 3: Build prompt ──────────────────────────────────────────────────
    let restrictInstruction = "";
    if (decision === "partial") {
      restrictInstruction = `Ignore non-existent features. Focus only on available matched features: ${matchResult.matchedFeatures.join(", ")}.`;
    }
    
    // Pass matchResult so the prompt enforcement layer can limit scope if needed
    const aiPrompt = promptService.generateTestCasesPrompt(cleanedMap, matchResult, restrictInstruction);

    // ── Step 4: AI call with tracking validator ───────────────────────────────
    const validator = makeQuickValidator(TEST_CASES_SCHEMA);
    let callCount   = 0;
    let aiOutputWarning = null;
    const trackingValidator = (raw) => { 
      callCount++; 
      if (!validator(raw)) return false;
      
      // POST-AI Validation: Validate context alignment
      const parsed = formatter.parseTestCasesArray(raw);
      const validationResult = guardrailService.validateAIOutput(parsed, allowedFeatures);
      
      if (validationResult.decision === "warning") {
         logger.warn("guardrail_hallucination", { 
           event: "validation", 
           allowedFeatures, 
           detectedTerms: validationResult.detectedTerms, 
           invalidTerms: validationResult.invalidTerms, 
           decision: validationResult.decision 
         });
         
         aiOutputWarning = `The AI included unknown domain features: ${validationResult.invalidTerms.join(", ")}`;
         return false; // Force retry. If maxRetries reached, fallback.
      } else {
         aiOutputWarning = null;
      }
      return true;
    };

    rawAiOutput = await complete(aiPrompt, { 
      validator: trackingValidator,
      correctionPrompt: `The previous response hallucinated features. STRICTLY limit your tags and test targets to these known features: [${allowedFeatures.join(", ")}].\n\n`,
      maxRetries: 1 // Limit retries to 1
    });
    retryCount  = Math.max(0, callCount - 1); // attempt 0 = first call

    // ── Step 5: Full validation pipeline ─────────────────────────────────────
    const validation = runValidationPipeline(rawAiOutput, TEST_CASES_SCHEMA);
    if (!validation.ok) {
      logger.warn("generate_validation_failed", { projectId, reason: validation.reason });
      validationErrors = [validation.reason];
      aiStatus = "fallback";
    }

    // ── Step 6: Parse ─────────────────────────────────────────────────────────
    const testCases = formatter.parseTestCasesArray(rawAiOutput);
    logger.info("generate_ok", { projectId, testCaseCount: testCases.length });

    const latencyMs = Date.now() - startMs;

    // ── Step 7: Persist message + generation (parallel) ───────────────────────
    if (userId) {
      await Promise.all([
        projectService.saveMessage(
          userId,
          projectId,
          userPrompt || aiPrompt.slice(0, 200),
          JSON.stringify({ testCases })
        ),
        projectService.saveGeneration({
          userId,
          projectId,
          prompt:           aiPrompt,
          normalizedPrompt: userPrompt,
          projectMap:       cleanedMap,
          response:         rawAiOutput,
          latencyMs,
          retryCount,
          status:           aiStatus,
          isValid:          validation.ok,
          validationErrors,
        }),
      ]);
    }

    // ── Step 8: Upsert coverage & returned features ───────────────────────────
    const returnedFeatures = [];
    if (userId && testCases.length > 0) {
      const coverageResults = matchResult.matchedFeatures.map(f => calculateCoverage(f, testCases));
      await projectService.upsertFeatureCoverage(userId, projectId, coverageResults);

      for (const cov of coverageResults) {
        const featureObj = extractedFeatures.find(f => f.normalizedName === cov.feature);
        returnedFeatures.push({
          name: cov.feature,
          files: featureObj ? featureObj.files : [],
          relatedFeatures: relationships.filter(r => r.feature === cov.feature).map(r => r.relatedFeature),
          coverage: cov.estimatedCoverage,
          confidence: matchResult.confidence,
          missingTestAreas: cov.missingAreas
        });
      }
      
      // Kept for backward compatibility if needed:
      const oldFeatures = contextService.extractTestFeatures(testCases);
      await projectService.upsertFeatures(userId, projectId, oldFeatures);
    }

    // ── Step 9: Respond ───────────────────────────────────────────────────────
    const responsePayload = {
      testCases,
      scripts:     null,
      insights:    contextService.insightsToArray(enrichedMap.codeInsights),
      suggestions: [],
      features:    returnedFeatures,
      meta: {
        projectId,
        latencyMs,
        retryCount,
        contextVersion: context?.contextVersion ?? 1,
        fallback:       aiStatus === "fallback",
        matchConfidence: matchResult.confidence
      },
    };

    if (matchResult.matchType === "partial") {
      responsePayload.warning = "Prompt only partially matched the project context. The output has been limited to known features.";
    }
    
    if (aiOutputWarning) {
      responsePayload.warning = (responsePayload.warning ? responsePayload.warning + " " : "") + aiOutputWarning;
    }

    return res.json(responsePayload);

  } catch (err) {
    const latencyMs = Date.now() - startMs;
    logger.error("generate_failed", { projectId, message: err.message, latencyMs });

    // Best-effort persistence — fire-and-forget; must not mask the original error
    if (userId) {
      projectService
        .saveGeneration({
          userId,
          projectId,
          prompt:           aiPrompt_safe(req.projectMap),
          response:         rawAiOutput,
          latencyMs,
          retryCount,
          status:           "error",
          isValid:          false,
          validationErrors: [err.message],
        })
        .catch((dbErr) =>
          logger.error("generation_persist_failed", { message: dbErr.message })
        );
    }

    return sendError(res, err, FALLBACK_GENERATE);
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Build a safe fallback prompt label for error-path persistence.
 * Avoids re-running the full promptService in the catch block.
 */
function aiPrompt_safe(projectMap) {
  if (!projectMap) return "(unknown — request map unavailable)";
  return `[error-path] type=${projectMap.type} lang=${projectMap.language}`;
}
