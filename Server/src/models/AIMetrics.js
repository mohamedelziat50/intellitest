/**
 * AIMetrics model — lightweight per-request performance tracking.
 * Used for analytics dashboards and SLA monitoring.
 */

import mongoose from "mongoose";

const { Schema, model } = mongoose;

const AIMetricsSchema = new Schema(
  {
    userId:       { type: Schema.Types.ObjectId, ref: "User", required: false, index: true },
    projectId:    { type: String, required: true, index: true },
    generationId: { type: Schema.Types.ObjectId, ref: "AIGeneration", index: true },
    latencyMs:    { type: Number, required: true },
    retryCount:   { type: Number, default: 0 },
    // null means success
    errorType:    { type: String, default: null },
  },
  { timestamps: true }
);

AIMetricsSchema.index({ userId: 1, projectId: 1, createdAt: -1 });

export const AIMetrics = model("AIMetrics", AIMetricsSchema);
