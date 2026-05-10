import bcrypt from "bcrypt";
import { User } from "../models/User.js";
import { signToken } from "../utils/jwt.js";
import { logger } from "../utils/logger.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LEN = 8;
const SALT_ROUNDS = 12;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function toUserResponse(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
  };
}

function validateSignupInput({ name, email, password }) {
  if (!name || String(name).trim() === "") return "Name is required.";
  if (!email || !EMAIL_RE.test(String(email).trim())) return "Valid email is required.";
  if (!password || String(password).length < PASSWORD_MIN_LEN) {
    return `Password must be at least ${PASSWORD_MIN_LEN} characters.`;
  }
  return "";
}

function validateLoginInput({ email, password }) {
  if (!email || !EMAIL_RE.test(String(email).trim())) return "Valid email is required.";
  if (!password || String(password).trim() === "") return "Password is required.";
  return "";
}

export async function signup(req, res) {
  const { name, email, password } = req.body || {};
  logger.info("auth_signup_received", { route: "/auth/signup", emailProvided: Boolean(email) });

  const validationError = validateSignupInput({ name, email, password });
  if (validationError) {
    logger.warn("auth_signup_validation_failed", {
      reason: validationError,
      emailAttempt: email != null ? normalizeEmail(String(email)) : null,
    });
    return res.status(400).json({
      source: "auth",
      type: "ValidationError",
      message: validationError,
    });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    logger.info("auth_signup_attempt", { email: normalizedEmail });

    const existing = await User.findOne({ email: normalizedEmail }).lean();
    if (existing) {
      logger.warn("auth_signup_conflict_email_in_use", { email: normalizedEmail });
      return res.status(409).json({
        source: "auth",
        type: "Conflict",
        message: "Email is already in use.",
      });
    }

    const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);
    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash,
    });

    const token = signToken(String(user._id));
    logger.info("auth_signup_success", {
      userId: String(user._id),
      email: normalizedEmail,
      name: String(user.name),
      jwtIssued: true,
    });
    return res.status(201).json({
      token,
      user: toUserResponse(user),
    });
  } catch (err) {
    if (err?.code === 11000) {
      logger.warn("auth_signup_conflict_duplicate_key", { email: normalizedEmail });
      return res.status(409).json({
        source: "auth",
        type: "Conflict",
        message: "Email is already in use.",
      });
    }
    logger.error("auth_signup_failed", { email: normalizedEmail, message: err.message });
    return res.status(500).json({
      source: "auth",
      type: "InternalError",
      message: "Failed to create account.",
    });
  }
}

export async function login(req, res) {
  const { email, password } = req.body || {};
  logger.info("auth_login_received", { route: "/auth/login", emailProvided: Boolean(email) });

  const validationError = validateLoginInput({ email, password });
  if (validationError) {
    logger.warn("auth_login_validation_failed", {
      reason: validationError,
      emailAttempt: email != null ? normalizeEmail(String(email)) : null,
    });
    return res.status(400).json({
      source: "auth",
      type: "ValidationError",
      message: validationError,
    });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    logger.info("auth_login_attempt", { email: normalizedEmail });

    const user = await User.findOne({ email: normalizedEmail }).select("+passwordHash");
    if (!user) {
      logger.warn("auth_login_rejected", {
        email: normalizedEmail,
        reason: "unknown_user",
      });
      return res.status(401).json({
        source: "auth",
        type: "Unauthorized",
        message: "Invalid email or password.",
      });
    }

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) {
      logger.warn("auth_login_rejected", {
        email: normalizedEmail,
        userId: String(user._id),
        reason: "bad_password",
      });
      return res.status(401).json({
        source: "auth",
        type: "Unauthorized",
        message: "Invalid email or password.",
      });
    }

    const token = signToken(String(user._id));
    logger.info("auth_login_success", {
      userId: String(user._id),
      email: normalizedEmail,
      jwtIssued: true,
    });
    return res.json({
      token,
      user: toUserResponse(user),
    });
  } catch (err) {
    logger.error("auth_login_error", { email: normalizedEmail, message: err.message });
    return res.status(500).json({
      source: "auth",
      type: "InternalError",
      message: "Failed to authenticate.",
    });
  }
}

export async function getMe(req, res) {
  const userId = req.user?.id || req.userId;
  if (!userId) {
    logger.warn("auth_me_rejected", { reason: "missing_user_id" });
    return res.status(401).json({
      source: "auth",
      type: "Unauthorized",
      message: "Unauthorized.",
    });
  }

  logger.info("auth_me_request", { userId: String(userId) });

  try {
    const user = await User.findById(userId).lean();
    if (!user) {
      logger.warn("auth_me_not_found", { userId: String(userId) });
      return res.status(404).json({
        source: "auth",
        type: "NotFound",
        message: "User not found.",
      });
    }
    logger.info("auth_me_success", {
      userId: String(user._id),
      email: user.email,
    });
    return res.json({ user: toUserResponse(user) });
  } catch (err) {
    logger.error("auth_me_error", { userId: String(userId), message: err.message });
    return res.status(500).json({
      source: "auth",
      type: "InternalError",
      message: "Failed to load user profile.",
    });
  }
}
