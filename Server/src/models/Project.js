/**
 * Project model — one document per workspace.
 * projectId is a stable hash or UUID sent by the extension.
 */

import mongoose from "mongoose";

const { Schema, model } = mongoose;

const ProjectSchema = new Schema(
  {
    userId:    { type: Schema.Types.ObjectId, ref: "User", required: false, index: true },
    projectId: { type: String, required: true, index: true },
    name:      { type: String, required: true, trim: true },
    type:      { type: String, default: "unknown" },         // e.g. "web", "api", "cli"
    techStack: {
      language:  { type: String, default: "" },
      framework: { type: String, default: "" },
      extras:    [String],                                   // any other detected tools
    },
  },
  { timestamps: true }
);

ProjectSchema.index({ userId: 1, projectId: 1 }, { unique: true });

export const Project = model("Project", ProjectSchema);
