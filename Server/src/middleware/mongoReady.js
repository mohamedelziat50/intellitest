import mongoose from "mongoose";
import { logger } from "../utils/logger.js";

/** Reject DB-backed routes immediately when Mongo is not connected (avoids Mongoose 10s buffer timeout). */
export function ensureMongoConnected(req, res, next) {
  if (mongoose.connection.readyState === 1) {
    return next();
  }
  logger.warn("auth_route_mongo_unavailable", {
    route: `${req.method} ${req.originalUrl}`,
    mongoReadyState: mongoose.connection.readyState,
  });
  return res.status(503).json({
    source: "backend",
    type: "ServiceUnavailable",
    message:
      "Database is not connected. Verify MONGODB_URI, that MongoDB / Atlas is reachable, and (for Atlas) that your IP is allowlisted.",
  });
}
