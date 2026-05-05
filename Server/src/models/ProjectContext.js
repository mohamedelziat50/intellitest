/**
 * ProjectContext model — accumulated knowledge about a project workspace.
 * Merged and updated on every /generate call to build richer prompts over time.
 */

import mongoose from "mongoose";

const { Schema, model } = mongoose;

const ProjectContextSchema = new Schema(
  {
    userId:    { type: Schema.Types.ObjectId, ref: "User", required: false, index: true },
    projectId: { type: String, required: true, index: true },

    // Aggregated structural knowledge from projectMap payloads
    modules:       [String],
    routes:        [String],
    priorityFiles: [String],

    // Shallow code insights: key → description string (e.g. { "auth": "JWT-based login" })
    codeInsights: { type: Map, of: String, default: {} },

    // Incremented each time we merge new data; lets the extension detect stale local cache
    contextVersion: { type: Number, default: 1 },
  },
  { timestamps: true }
);

ProjectContextSchema.index({ userId: 1, projectId: 1 }, { unique: true });

export const ProjectContext = model("ProjectContext", ProjectContextSchema);
