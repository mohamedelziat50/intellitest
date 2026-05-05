import mongoose from "mongoose";

const CoverageHistorySchema = new mongoose.Schema({
  feature: { type: String },
  coverage: { type: Number },
  timestamp: { type: Date, default: Date.now },
  projectId: { type: String }
});

export default mongoose.model("CoverageHistory", CoverageHistorySchema);
