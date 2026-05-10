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

import * as promptService from "../services/promptService.js";
import * as projectService from "../services/projectService.js";
import * as contextService from "../services/contextService.js";
import * as guardrailService from "../services/guardrailService.js";
import { extractFeatures, buildFeatureRelationships } from "../services/featureExtractionService.js";
import { mapPromptToFeatures } from "../services/featureMappingEngine.js";
import { calculateCoverage } from "../services/coverageEngine.js";
import * as formatter from "../utils/formatter.js";
import { logTerminalSection, logger } from "../utils/logger.js";
import { complete } from "../ai/aiService.js";
import { sendError } from "../utils/errorHandler.js";
import {
  runValidationPipeline,
  makeQuickValidator,
  TEST_CASES_SCHEMA,
} from "../validators/outputValidator.js";

// ── Safe fallback (returned alongside error payloads) ─────────────────────────

const FALLBACK_GENERATE = Object.freeze({
  testCases: [],
  scripts: null,
  insights: [],
  suggestions: [],
  meta: { fallback: true, message: "AI could not produce valid output. Please try again." },
});

/**
 * mapPromptToFeatures() returns `{ decision, features, ... }` but this controller expects
 * `matchType`, `matchedFeatures`, `relatedFeatures`, `confidence` (legacy shape).
 */
function adaptFeatureMappingResult(engineResult) {
  const features = Array.isArray(engineResult?.features) ? engineResult.features : [];
  const matchedFeatures = features.map((f) => f.name).filter(Boolean);

  const relatedFeatures = [];
  const seenRelated = new Set();
  for (const f of features) {
    for (const rel of f.relatedFeatures || []) {
      const name = typeof rel === "string" ? rel : rel?.name;
      if (name && !seenRelated.has(name)) {
        seenRelated.add(name);
        relatedFeatures.push(name);
      }
    }
  }

  let matchType = engineResult?.decision ?? "none";
  if (matchType === "strong") {
    matchType = "allowed";
  }

  return {
    decision: engineResult?.decision ?? "none",
    features,
    warnings: engineResult?.warnings ?? [],
    suggestions: engineResult?.suggestions ?? [],
    matchType,
    matchedFeatures,
    relatedFeatures,
    confidence: features[0]?.confidence ?? 0,
    closestFlows: engineResult?.closestFlows ?? [],
  };
}

// ── Controller ─────────────────────────────────────────────────────────────────

/**
 * POST /generate
 * @type {import("express").RequestHandler}
 */
export async function generate(req, res) {
  const startMs = Date.now();
  const userId = req.userId || req.user?.id; // extracted from authMiddleware
  const projectId = req.projectId;          // set by validateGenerate
  const projectMap = req.projectMap;          // set by validateGenerate
  const userPrompt = projectMap.prompt ?? "";

  logTerminalSection("POST /generate — userId", userId);
  logTerminalSection("POST /generate — projectId", projectId);
  logTerminalSection("POST /generate — projectMap", projectMap);

  // Mutable state scoped to this request — used in both success + error paths
  let rawAiOutput = "";
  let retryCount = 0;
  let aiStatus = "ok";
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

    // ── Step 2.2: Load Global Intelligence Graph ─────────────────────────────
    // We no longer build the graph here! It's built globally by /sync.
    // We just load the existing features from MongoDB to enforce guardrails.
    let extractedFeatures = [];
    if (userId) {
      extractedFeatures = await projectService.loadFeatures(userId, projectId);
    }
    if (extractedFeatures.length === 0) {
      extractedFeatures = extractFeatures(projectMap, null);
    }

    // 🔥 FIX: We MUST build the relationships here! Otherwise the E2E related features are thrown away.
    const relationships = buildFeatureRelationships(extractedFeatures, null);
    const allowedFeatures = extractedFeatures.map(f => f.name || f.normalizedName);

    // ── Step 2.5: Guardrail Decision Layer (Feature Intelligence) ─────────────
    const matchResult = mapPromptToFeatures(userPrompt, extractedFeatures, relationships);

    let decision = "allowed";
    if (userPrompt.trim().length > 0) {
      decision = matchResult.decision;
    }

    const matchedFeatureNames = matchResult.features.map(f => f.name);
    const isFlowTest = /flow|e2e|integration|process|end to end/i.test(userPrompt);

    let allowedToFocus = [...matchedFeatureNames];
    if (isFlowTest) {
      const relatedFeatureNames = matchResult.features.flatMap(f => f.relatedFeatures.map(r => r.name));
      allowedToFocus = [...new Set([...allowedToFocus, ...relatedFeatureNames])];
    }
    const hasCatalog = allowedFeatures.length > 0;
    if (userPrompt.trim().length > 0 && !hasCatalog) {
      decision = "allowed";
    }

    let coverageMap = {};
    if (userId && matchedFeatureNames.length > 0) {
      const coverages = await projectService.loadFeatureCoverage(userId, projectId, matchedFeatureNames);
      for (const c of coverages) {
        coverageMap[c.feature] = c;
      }

    }

    logger.info("feature_mapping", {
      event: "feature_mapping",
      prompt: userPrompt,
      extractedFeatures: allowedFeatures,
      matchedFeatures: matchedFeatureNames,
      relatedFeatures: matchResult.features.flatMap(f => f.relatedFeatures.map(r => r.name)),
      coverage: coverageMap,
      confidence: matchResult.confidence,
      decision: decision === "none" ? "fallback" : decision
    });

    // When we *do* have a catalog but nothing matched the prompt, return structured fallback instead of bogus empty testCases.
    if (decision === "none" && userPrompt.trim().length > 0 && hasCatalog) {
      return res.json({
        warning: "Feature not found",
        suggestions: matchResult.suggestions || ["product", "collection"],
        action: "fallback",
        features: [],
        testCases: [],
      });
    }

    // ── Step 3: Build prompt ──────────────────────────────────────────────────
    let restrictInstruction = "";
    if (decision === "partial") {
      restrictInstruction = `Ignore non-existent features. Focus only on available matched features: ${allowedToFocus.join(", ")}.`;
    }

    // 🔥 FIX: Create a strict map from the incoming payload so we don't bloat the LLM
    // with historical routes from the enriched/cleaned map.
    const strictMap = contextService.cleanContext(projectMap);

    // Pass matchResult so the prompt enforcement layer can limit scope if needed
    const aiPrompt = promptService.generateTestCasesPrompt(strictMap, matchResult, restrictInstruction);

    // ── Step 4: AI call with tracking validator ───────────────────────────────
    const validator = makeQuickValidator(TEST_CASES_SCHEMA);
    let callCount = 0;
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
    retryCount = Math.max(0, callCount - 1); // attempt 0 = first call

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
          prompt: aiPrompt,
          normalizedPrompt: userPrompt,
          projectMap: cleanedMap,
          response: rawAiOutput,
          latencyMs,
          retryCount,
          status: aiStatus,
          isValid: validation.ok,
          validationErrors,
        }),
      ]);
    }

    // ── Step 8: Upsert coverage & returned features ───────────────────────────
    const returnedFeatures = [];
    if (userId && testCases.length > 0) {
      const coverageResults = matchedFeatureNames.map(f => calculateCoverage(f, testCases));
      await projectService.upsertFeatureCoverage(userId, projectId, coverageResults);

      for (const cov of coverageResults) {
        const featureObj = extractedFeatures.find(f => f.normalizedName === cov.feature);
        const matchFeat = matchResult.features.find(f => f.name === cov.feature);
        returnedFeatures.push({
          name: featureName,
          files: featureObj ? featureObj.files : [],
          relatedFeatures: matchFeat ? matchFeat.relatedFeatures.map(r => r.name) : [],
          coverage: cov.estimatedCoverage,
          confidence: matchFeat ? matchFeat.confidence : 0,
          missingTestAreas: cov.missingAreas
        });
      }
    }

    // ── Step 9: Respond ───────────────────────────────────────────────────────
    const responsePayload = {
      testCases,
      scripts: null,
      insights: contextService.insightsToArray(enrichedMap.codeInsights),
      suggestions: [],
      features: returnedFeatures,
      meta: {
        projectId,
        latencyMs,
        retryCount,
        contextVersion: context?.contextVersion ?? 1,
        fallback: aiStatus === "fallback",
        matchConfidence: matchResult.features.length > 0 ? matchResult.features[0].confidence : 0
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
          prompt: aiPrompt_safe(req.projectMap),
          response: rawAiOutput,
          latencyMs,
          retryCount,
          status: "error",
          isValid: false,
          validationErrors: [err.message],
        })
        .catch((dbErr) =>
          logger.error("generation_persist_failed", { message: dbErr.message })
        );
    }

    return sendError(res, err, FALLBACK_GENERATE);
  }
}

/**
 * POST /analyze-intent
 * Fast pre-flight check to determine relevant features and files for a prompt
 */
export async function analyzeIntent(req, res) {
  try {
    const { prompt, projectId, files } = req.body;
    if (!prompt) return res.json({ decision: "none", matchedFeatures: [], relatedFeatures: [], relevantFiles: [] });

    // We create a mock projectMap to run feature extraction on the lightweight file list.
    // 🔥 FIX: We pass 'null' instead of projectId to explicitly bypass the backend cache.
    // This ensures that if the user just created a new file in VS Code 2 seconds ago,
    // the intent analyzer will instantly know about it without needing a "Reset Cache" button!
    const mockMap = { files: files || [] };
    const extractedFeatures = extractFeatures(mockMap, null);
    const relationships = buildFeatureRelationships(extractedFeatures, null);

    const matchResult = mapPromptToFeatures(prompt, extractedFeatures, relationships);

    // Collect all relevant files from matched and related features
    const relevantFilesSet = new Set();
    const matchedFeatureNames = matchResult.features.map(f => f.name);

    for (const mf of matchResult.features) {
      if (mf.files) mf.files.forEach(f => relevantFilesSet.add(f));
    }

    // Detect if the user wants an E2E/Flow test (Chain Command Awareness)
    const isFlowTest = /flow|e2e|integration|process|end to end/i.test(prompt);
    const relatedFeatureNames = matchResult.features.flatMap(f => f.relatedFeatures.map(r => r.name));

    // If it's a flow test, we traverse the dependency graph and pull in the whole chain!
    if (isFlowTest) {
      for (const rf of relatedFeatureNames) {
        const feat = extractedFeatures.find(f => f.normalizedName === rf);
        if (feat && feat.files) {
          // 🔥 FIX: Instead of an arbitrary slice(0, 5), we intelligently rank the files.
          // We prioritize files that are likely the "core" of the dependency (services, controllers, 
          // or files that directly contain the feature name).
          const allFiles = Array.from(feat.files);

          const coreFiles = allFiles.filter(f =>
            f.toLowerCase().includes(rf) ||
            /service|controller|api|route|index/i.test(f)
          );

          // Fallback to other files if we didn't find clear "core" files
          const finalFiles = coreFiles.length > 0 ? coreFiles : allFiles;

          // Cap at 10 to protect the parser, but now we know we have the most important ones.
          finalFiles.slice(0, 10).forEach(f => relevantFilesSet.add(f));
        }
      }
    }

    return res.json({
      decision: matchResult.decision,
      matchedFeatures: matchedFeatureNames,
      relatedFeatures: relatedFeatureNames,
      relevantFiles: Array.from(relevantFilesSet),
      isFlowTest: isFlowTest,
      suggestions: matchResult.suggestions || []
    });
  } catch (err) {
    logger.error("analyze_intent_failed", { message: err.message });
    return res.status(500).json({ error: "Failed to analyze intent" });
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
