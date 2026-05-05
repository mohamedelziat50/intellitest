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
  const validationError = validateSignupInput({ name, email, password });
  if (validationError) {
    return res.status(400).json({
      source: "auth",
      type: "ValidationError",
      message: validationError,
    });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const existing = await User.findOne({ email: normalizedEmail }).lean();
    if (existing) {
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
    return res.status(201).json({
      token,
      user: toUserResponse(user),
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        source: "auth",
        type: "Conflict",
        message: "Email is already in use.",
      });
    }
    logger.error("signup_failed", { message: err.message });
    return res.status(500).json({
      source: "auth",
      type: "InternalError",
      message: "Failed to create account.",
    });
  }
}

export async function login(req, res) {
  const { email, password } = req.body || {};
  const validationError = validateLoginInput({ email, password });
  if (validationError) {
    return res.status(400).json({
      source: "auth",
      type: "ValidationError",
      message: validationError,
    });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const user = await User.findOne({ email: normalizedEmail }).select("+passwordHash");
    if (!user) {
      return res.status(401).json({
        source: "auth",
        type: "Unauthorized",
        message: "Invalid email or password.",
      });
    }

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) {
      return res.status(401).json({
        source: "auth",
        type: "Unauthorized",
        message: "Invalid email or password.",
      });
    }

    const token = signToken(String(user._id));
    return res.json({
      token,
      user: toUserResponse(user),
    });
  } catch (err) {
    logger.error("login_failed", { message: err.message });
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
    return res.status(401).json({
      source: "auth",
      type: "Unauthorized",
      message: "Unauthorized.",
    });
  }

  try {
    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({
        source: "auth",
        type: "NotFound",
        message: "User not found.",
      });
    }
    return res.json({ user: toUserResponse(user) });
  } catch (err) {
    logger.error("get_me_failed", { message: err.message });
    return res.status(500).json({
      source: "auth",
      type: "InternalError",
      message: "Failed to load user profile.",
    });
  }
}
