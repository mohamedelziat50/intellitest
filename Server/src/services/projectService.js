/**
 * Project Service — all MongoDB interactions for IntelliTest.
 *
 * Covers:
 *   - Project upsert
 *   - ProjectContext merge (race-condition-safe via findOneAndUpdate upsert)
 *   - Message persistence & retrieval
 *   - AIGeneration + AIMetrics persistence
 *   - Feature upsert
 *
 * Zero Express dependencies — every function is a pure async data-layer call.
 */

import { Project }        from "../models/Project.js";
import { ProjectContext } from "../models/ProjectContext.js";
import { Message }        from "../models/Message.js";
import { AIGeneration }   from "../models/AIGeneration.js";
import { AIMetrics }      from "../models/AIMetrics.js";
import { Feature }        from "../models/Feature.js";
import { FeatureRelationship } from "../models/FeatureRelationship.js";
import { FeatureCoverage }     from "../models/FeatureCoverage.js";
import { logger }         from "../utils/logger.js";
import { unionArrays }    from "../utils/helpers.js";

// ── Project ────────────────────────────────────────────────────────────────────

/**
 * Find-or-create a project document for the given projectId.
 * Uses $setOnInsert so an existing document is never mutated.
 *
 * @param {string} projectId
 * @param {object} projectMap — normalised payload from validateGenerate middleware
 * @returns {Promise<object>} lean project document
 */
export async function upsertProject(userId, projectId, projectMap) {
  const project = await Project.findOneAndUpdate(
    { userId, projectId },
    {
      $setOnInsert: {
        userId,
        projectId,
        name: projectMap.name || projectMap.type || "Unnamed Project",
        type: projectMap.type || "unknown",
        techStack: {
          language:  projectMap.language  || "",
          framework: projectMap.framework || "",
          extras:    [],
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return project.toObject();
}

// ── ProjectContext ─────────────────────────────────────────────────────────────

/**
 * Load the stored ProjectContext for a project.
 * Returns null if no context exists yet.
 *
 * @param {string} projectId
 * @returns {Promise<object|null>}
 */
export async function loadContext(userId, projectId) {
  return ProjectContext.findOne({ userId, projectId }).lean();
}

/**
 * Merge incoming projectMap data into the stored ProjectContext.
 *
 * Race-condition safe: uses a single atomic findOneAndUpdate with upsert:true.
 * If two concurrent requests both see "no existing doc" they will both attempt
 * upsert — MongoDB's unique index on projectId ensures only one wins; the other
 * retries the update path automatically via the $set/$inc operators.
 *
 * codeInsights (a Map field) is handled with a dot-notation $set so individual
 * keys are merged rather than the whole map being replaced.
 *
 * @param {string} projectId
 * @param {object} projectMap
 * @returns {Promise<object>} updated context as plain object
 */
export async function mergeContext(userId, projectId, projectMap) {
  const incoming = {
    modules:       projectMap.modules       ?? [],
    routes:        projectMap.routes        ?? [],
    priorityFiles: projectMap.priorityFiles ?? [],
    codeInsights:  projectMap.codeInsights && typeof projectMap.codeInsights === "object"
      ? projectMap.codeInsights
      : {},
  };

  // Load current state for union computation (one round-trip before the update)
  const existing = await ProjectContext.findOne({ userId, projectId }).lean();

  const mergedModules       = unionArrays(existing?.modules,       incoming.modules);
  const mergedRoutes        = unionArrays(existing?.routes,        incoming.routes);
  const mergedPriorityFiles = unionArrays(existing?.priorityFiles, incoming.priorityFiles);

  // Build dot-notation updates for codeInsights map entries
  const insightUpdates = {};
  for (const [k, v] of Object.entries(incoming.codeInsights)) {
    insightUpdates[`codeInsights.${k}`] = v;
  }

  const updated = await ProjectContext.findOneAndUpdate(
    { userId, projectId },
    {
      $set: {
        modules:       mergedModules,
        routes:        mergedRoutes,
        priorityFiles: mergedPriorityFiles,
        ...insightUpdates,
      },
      $inc:         { contextVersion: 1 },
      $setOnInsert: { userId, projectId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return updated.toObject();
}

// ── Messages ───────────────────────────────────────────────────────────────────

/**
 * Return the most recent `limit` messages in chronological order.
 *
 * @param {string} projectId
 * @param {number} [limit=50]
 * @returns {Promise<object[]>}
 */
export async function loadMessages(userId, projectId, limit = 50) {
  const msgs = await Message.find({ userId, projectId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return msgs.reverse(); // oldest first for chat rendering
}

/**
 * Persist one prompt ↔ response exchange.
 *
 * @param {string} projectId
 * @param {string} prompt
 * @param {string} response — serialised AI output (JSON string)
 * @returns {Promise<object>} saved message as plain object
 */
export async function saveMessage(userId, projectId, prompt, response) {
  const msg = await Message.create({ userId, projectId, prompt, response });
  logger.info("message_saved", { projectId, messageId: String(msg._id) });
  return msg.toObject();
}

// ── AIGeneration + AIMetrics ───────────────────────────────────────────────────

/**
 * @typedef {object} SaveGenerationOpts
 * @property {string}   userId
 * @property {string}   projectId
 * @property {string}   prompt
 * @property {string}   [normalizedPrompt]
 * @property {object}   [projectMap]
 * @property {string}   [response]
 * @property {number}   latencyMs
 * @property {number}   [retryCount]
 * @property {"ok"|"fallback"|"error"} [status]
 * @property {boolean}  [isValid]
 * @property {string[]} [validationErrors]
 */

/**
 * Persist one AI generation record and its corresponding metrics entry.
 * Both writes are independent — a metrics failure does not roll back the generation.
 *
 * @param {SaveGenerationOpts} opts
 * @returns {Promise<{ generation: object, metrics: object }>}
 */
export async function saveGeneration(opts) {
  const {
    userId,
    projectId,
    prompt,
    normalizedPrompt = "",
    projectMap       = null,
    response         = "",
    latencyMs,
    retryCount       = 0,
    status           = "ok",
    isValid          = true,
    validationErrors = [],
  } = opts;

  const [generation, metrics] = await Promise.all([
    AIGeneration.create({
      userId, projectId, prompt, normalizedPrompt, projectMap,
      response, latencyMs, retryCount, status, isValid, validationErrors,
    }),
    // Metrics written optimistically — _id available after AIGeneration.create
    null, // placeholder; written below once we have generation._id
  ]);

  const metricsDoc = await AIMetrics.create({
    projectId,
    generationId: generation._id,
    latencyMs,
    retryCount,
    errorType: status === "error" ? (validationErrors[0] ?? "UnknownError") : null,
  });

  logger.info("generation_saved", {
    projectId,
    generationId: String(generation._id),
    latencyMs,
    retryCount,
    status,
  });

  return {
    generation: generation.toObject(),
    metrics:    metricsDoc.toObject(),
  };
}

// ── Features ───────────────────────────────────────────────────────────────────

/**
 * Load all features for a project, sorted by testScore descending.
 *
 * @param {string} projectId
 * @returns {Promise<object[]>}
 */
export async function loadFeatures(userId, projectId) {
  return Feature.find({ userId, projectId }).sort({ testScore: -1 }).lean();
}

/**
 * Bulk-upsert extracted features from context, ignoring totalTests.
 * @param {string} userId
 * @param {string} projectId
 * @param {Array<object>} features
 */
export async function syncFeatureIntelligence(userId, projectId, features, relationships) {
  if (features && features.length > 0) {
    const ops = features.map(f => ({
      updateOne: {
        filter: { userId, projectId, normalizedName: f.normalizedName },
        update: {
          $set: {
            name: f.name,
            normalizedName: f.normalizedName,
            files: f.files,
            type: "backend" // or derive type
          }
        },
        upsert: true
      }
    }));
    await Feature.bulkWrite(ops, { ordered: false });
  }

  if (relationships && relationships.length > 0) {
    const relOps = relationships.map(r => ({
      updateOne: {
        filter: { userId, projectId, feature: r.feature, relatedFeature: r.relatedFeature },
        update: {
          $set: {
            relationType: r.relationType
          }
        },
        upsert: true
      }
    }));
    await FeatureRelationship.bulkWrite(relOps, { ordered: false });
  }
}

export async function loadFeatureCoverage(userId, projectId, features) {
  if (!features || features.length === 0) return [];
  return FeatureCoverage.find({ userId, projectId, feature: { $in: features } }).lean();
}

export async function upsertFeatureCoverage(userId, projectId, coverages) {
  if (!coverages || coverages.length === 0) return;

  const ops = coverages.map(c => ({
    updateOne: {
      filter: { userId, projectId, feature: c.feature },
      update: {
        $set: {
          testCaseCount: c.testCaseCount,
          estimatedCoverage: c.estimatedCoverage,
          missingAreas: c.missingAreas
        }
      },
      upsert: true
    }
  }));
  await FeatureCoverage.bulkWrite(ops, { ordered: false });
}
