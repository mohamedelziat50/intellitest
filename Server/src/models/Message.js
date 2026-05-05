/**
 * Message model — persistent chat history per project.
 * Each document is one user ↔ AI exchange.
 */

import mongoose from "mongoose";

const { Schema, model } = mongoose;

const MessageSchema = new Schema(
  {
    userId:   { type: Schema.Types.ObjectId, ref: "User", required: false, index: true },
    projectId: { type: String, required: true, index: true },
    prompt:    { type: String, required: true },
    response:  { type: String, required: true },

    // Optional thumbs-up / thumbs-down (-1 | 0 | 1)
    rating: { type: Number, enum: [-1, 0, 1], default: 0 },
  },
  { timestamps: true }
);

// Compound index so we can efficiently page chat history for a project
MessageSchema.index({ userId: 1, projectId: 1, createdAt: -1 });

export const Message = model("Message", MessageSchema);
