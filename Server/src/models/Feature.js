/**
 * Feature model — detected software features and their testing health scores.
 * Upserted per-project as new test generations come in.
 */

import mongoose from "mongoose";

const FeatureSchema = new mongoose.Schema({
  name: { type: String, required: true },
  normalizedName: { type: String, required: true },

  type: {
    type: String,
    enum: ["ui", "backend", "api", "service"],
    default: "ui"
  },

  importanceScore: { type: Number, default: 0.5 },

  files: [{ type: String }],
  synonyms: [{ type: String }],

  projectId: { type: String, required: true },

  createdAt: { type: Date, default: Date.now }
});

// Indexing for deduplication and performance
FeatureSchema.index({ normalizedName: 1, projectId: 1 }, { unique: true });

export const Feature = mongoose.model("Feature", FeatureSchema);
export default Feature;
