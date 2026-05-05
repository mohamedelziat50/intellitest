import mongoose from "mongoose";

const FeatureCoverageSchema = new mongoose.Schema({
  feature: { type: String, required: true },
  projectId: { type: String, required: true },

  coveredScenarios: [{ type: String }],
  missingScenarios: [{ type: String }],
  
  coverage: { type: Number, default: 0 },
  confidence: { type: Number, default: 0 },

  updatedAt: { type: Date, default: Date.now }
});

FeatureCoverageSchema.index({ feature: 1, projectId: 1 }, { unique: true });

export const FeatureCoverage = mongoose.model("FeatureCoverage", FeatureCoverageSchema);
export default FeatureCoverage;
