/**
 * server.js — process entry point.
 *
 * Responsibilities (only):
 *   1. Load env (dotenv)
 *   2. Connect DB
 *   3. Create Express app
 *   4. Start HTTP listener
 *   5. Register graceful-shutdown handlers (SIGTERM / SIGINT)
 */

import "dotenv/config";
import { server as serverConfig } from "./config.js";
import { createApp }    from "./app.js";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "./db/connection.js";
import { logger }       from "./utils/logger.js";

async function main() {
  // ── 1. Connect to MongoDB ─────────────────────────────────────────────────
  // Non-fatal: a DB failure logs a warning but lets the server start.
  // Auth routes use ensureMongoConnected middleware (503 immediately).
  // Disabling command buffering avoids queued User.findOne() calls waiting ~10s then timing out.
  try {
    await connectDB();
  } catch (err) {
    mongoose.set("bufferCommands", false);
    logger.warn("mongodb_connection_failed_at_startup", {
      message: err.message,
      hint:    "Check MONGODB_URI in Server/.env — /auth/* returns 503 until DB is reachable.",
    });
  }

  // ── 2. Bootstrap Express ──────────────────────────────────────────────────
  const app = createApp();

  // ── 3. Start HTTP server ──────────────────────────────────────────────────
  const httpServer = app.listen(serverConfig.port, () => {
    logger.info("server_started", {
      port: serverConfig.port,
      env:  serverConfig.nodeEnv,
    });
  });

  // ── 4. Graceful shutdown ──────────────────────────────────────────────────
  async function shutdown(signal) {
    logger.info("shutdown_signal_received", { signal });

    // Stop accepting new connections
    httpServer.close(async () => {
      try {
        await disconnectDB();
        logger.info("shutdown_complete");
        process.exit(0);
      } catch (err) {
        logger.error("shutdown_error", { message: err.message });
        process.exit(1);
      }
    });

    // Force-exit if shutdown takes too long (15 s)
    setTimeout(() => {
      logger.error("shutdown_timeout");
      process.exit(1);
    }, 15_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.error("uncaught_exception", { message: err.message, stack: err.stack?.slice(0, 600) });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    logger.error("unhandled_rejection", { message: msg });
    // Do not exit — log and let the in-flight request fail naturally
  });
}

main().catch((err) => {
  // Startup failure (e.g. DB unreachable) — log and exit immediately
  console.error(JSON.stringify({
    level: "error",
    time:  new Date().toISOString(),
    message: "startup_failed",
    detail:  err.message,
    stack:   err.stack?.slice(0, 600),
  }));
  process.exit(1);
});
