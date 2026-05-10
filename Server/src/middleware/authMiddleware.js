import { verifyToken } from "../utils/jwt.js";
import { logger } from "../utils/logger.js";

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") {
    logger.warn("auth_middleware_rejected", {
      route: `${req.method} ${req.originalUrl}`,
      reason: "missing_header",
    });
    return res.status(401).json({
      source: "auth",
      type: "Unauthorized",
      message: "Missing Authorization header.",
    });
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    logger.warn("auth_middleware_rejected", {
      route: `${req.method} ${req.originalUrl}`,
      reason: "bad_scheme",
    });
    return res.status(401).json({
      source: "auth",
      type: "Unauthorized",
      message: "Authorization header must be in the format: Bearer <token>.",
    });
  }

  try {
    const payload = verifyToken(token);
    if (!payload || !payload.userId) {
      logger.warn("auth_middleware_rejected", {
        route: `${req.method} ${req.originalUrl}`,
        reason: "payload_missing_user_id",
      });
      return res.status(401).json({
        source: "auth",
        type: "Unauthorized",
        message: "Invalid authentication token.",
      });
    }

    req.user = { id: String(payload.userId) };
    req.userId = String(payload.userId);
    return next();
  } catch (err) {
    logger.warn("auth_middleware_rejected", {
      route: `${req.method} ${req.originalUrl}`,
      reason: "verify_threw_or_expired",
      message: err?.message,
    });
    return res.status(401).json({
      source: "auth",
      type: "Unauthorized",
      message: "Invalid or expired token.",
    });
  }
}

// Optional auth: allow requests without Authorization header.
// If a valid token is provided, attach `req.user` / `req.userId` like the strict middleware.
// If no token or an invalid token is present, continue as a guest (no 401).
export function optionalAuthMiddleware(req, _res, next) {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") {
    req.user = { guest: true };
    req.userId = null;
    return next();
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    req.user = { guest: true };
    req.userId = null;
    return next();
  }

  try {
    const payload = verifyToken(token);
    if (payload && payload.userId) {
      req.user = { id: String(payload.userId) };
      req.userId = String(payload.userId);
    } else {
      req.user = { guest: true };
      req.userId = null;
    }
  } catch (err) {
    req.user = { guest: true };
    req.userId = null;
  }

  return next();
}
