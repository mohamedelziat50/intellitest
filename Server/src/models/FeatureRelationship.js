import mongoose from "mongoose";

const FeatureRelationshipSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

  source: { type: String, required: true },
  target: { type: String, required: true },

  type: {
    type: String,
    enum: ["depends_on", "triggers", "extends", "belongs_to", "ui_for"],
    required: true
  },

  projectId: { type: String, required: true }
});

FeatureRelationshipSchema.index({ userId: 1, source: 1, target: 1, type: 1, projectId: 1 }, { unique: true });
FeatureRelationshipSchema.index({ userId: 1, projectId: 1 });

export const FeatureRelationship = mongoose.model("FeatureRelationship", FeatureRelationshipSchema);
export default FeatureRelationship;
