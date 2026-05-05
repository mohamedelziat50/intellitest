/**
 * AIGeneration model — full audit trail of every AI call.
 * Stores the prompt, response, latency, retry info, and validation results.
 */

import mongoose from "mongoose";

const { Schema, model } = mongoose;

const AIGenerationSchema = new Schema(
  {
    userId:           { type: Schema.Types.ObjectId, ref: "User", required: false, index: true },
    projectId:        { type: String, required: true, index: true },
    prompt:           { type: String, required: true },
    normalizedPrompt: { type: String, default: "" },
    projectMap:       { type: Schema.Types.Mixed, default: null }, // snapshot of the payload

    response:  { type: String, default: "" },
    latencyMs: { type: Number, default: 0 },
    retryCount: { type: Number, default: 0 },

    // "ok" | "fallback" | "error"
    status:  { type: String, enum: ["ok", "fallback", "error"], default: "ok" },

    isValid: { type: Boolean, default: true },
    validationErrors: [String],
  },
  { timestamps: true }
);

AIGenerationSchema.index({ userId: 1, projectId: 1, createdAt: -1 });

export const AIGeneration = model("AIGeneration", AIGenerationSchema);
