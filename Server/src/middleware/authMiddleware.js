import { verifyToken } from "../utils/jwt.js";

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") {
    return res.status(401).json({
      source: "auth",
      type: "Unauthorized",
      message: "Missing Authorization header.",
    });
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      source: "auth",
      type: "Unauthorized",
      message: "Authorization header must be in the format: Bearer <token>.",
    });
  }

  try {
    const payload = verifyToken(token);
    if (!payload || !payload.userId) {
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
