/**
 * MongoDB connection factory.
 *
 * Call connectDB() once in server.js before app.listen().
 * Call disconnectDB() in graceful-shutdown handlers.
 *
 * Configuration is read from config.js — no direct process.env access here.
 */

import mongoose from "mongoose";
import { db as dbConfig } from "../config.js";
import { logger } from "../utils/logger.js";

export async function connectDB() {
  mongoose.connection.on("connected", () => logger.info("mongodb_connected", { uri: dbConfig.uri }));
  mongoose.connection.on("error", (e) => logger.warn("mongodb_error", { message: e.message }));
  mongoose.connection.on("disconnected", () => logger.warn("mongodb_disconnected"));

  await mongoose.connect(dbConfig.uri, {
    serverSelectionTimeoutMS: dbConfig.serverSelectionTimeout,
    socketTimeoutMS: dbConfig.socketTimeout,
  });
}

export async function disconnectDB() {
  await mongoose.disconnect();
  logger.info("mongodb_disconnected_gracefully");
}
