/**
 * config.js — Single source of truth for all environment-derived configuration.
 *
 * All process.env reads happen here. The rest of the codebase imports from this
 * module, making it trivial to swap env sources (e.g., AWS SSM, Vault) later.
 *
 * Validated at startup: if a required variable is missing, the server will
 * throw before accepting any traffic.
 */

function requireEnv(key) {
  const val = process.env[key];
  if (!val || val.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val.trim();
}

function optionalEnv(key, fallback) {
  const val = process.env[key];
  return val && val.trim() !== "" ? val.trim() : fallback;
}

function optionalInt(key, fallback) {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// ── Server ─────────────────────────────────────────────────────────────────────
export const server = Object.freeze({
  port: optionalInt("PORT", 3000),
  nodeEnv: optionalEnv("NODE_ENV", "development"),
  isDev: optionalEnv("NODE_ENV", "development") === "development",
});

// ── MongoDB ────────────────────────────────────────────────────────────────────
export const db = Object.freeze({
  uri:                    optionalEnv("MONGODB_URI", "mongodb://127.0.0.1:27017/intellitest"),
  serverSelectionTimeout: optionalInt("MONGO_SERVER_SELECTION_TIMEOUT_MS", 10_000),
  socketTimeout:          optionalInt("MONGO_SOCKET_TIMEOUT_MS",           45_000),
});

// ── AI Provider ───────────────────────────────────────────────────────────────
const provider = optionalEnv("LLM_PROVIDER", "ollama").toLowerCase();

export const ai = Object.freeze({
  provider,

  // Ollama (local)
  ollamaBase: optionalEnv("OLLAMA_BASE_URL", "http://localhost:11434"),
  ollamaModel: optionalEnv("OLLAMA_MODEL", "llama3.2"),

  // OpenAI-compatible API (Groq default; set API_BASE_URL for OpenAI and others)
  apiBase: optionalEnv("API_BASE_URL", "https://api.groq.com/openai/v1"),
  apiKey: optionalEnv("API_KEY", optionalEnv("GROQ_API_KEY", "")),
  apiModel: optionalEnv("API_MODEL", "llama-3.3-70b-versatile"),

  // Timeouts & retries
  timeoutMs: optionalInt("AI_TIMEOUT_MS", 30_000),
  maxRetries: optionalInt("AI_MAX_RETRIES", 2),
});

// ── Rate Limiter ───────────────────────────────────────────────────────────────
export const rateLimit = Object.freeze({
  windowMs: optionalInt("RATE_LIMIT_WINDOW_MS", 60_000),
  max: optionalInt("RATE_LIMIT_MAX", 20),
});

// ── Logging ────────────────────────────────────────────────────────────────────
export const log = Object.freeze({
  level: optionalEnv("LOG_LEVEL", "info"),
  maxSectionChars: optionalInt("LOG_MAX_SECTION_CHARS", 80_000),
});

// ── CORS ───────────────────────────────────────────────────────────────────────
export const cors = Object.freeze({
  // Comma-separated list of allowed origins, or "*" for open (dev only)
  allowedOrigins: optionalEnv("CORS_ALLOWED_ORIGINS", "*"),
});

// ── Auth ───────────────────────────────────────────────────────────────────────
export const auth = Object.freeze({
  jwtSecret: optionalEnv("JWT_SECRET", "super-secret-development-key-change-in-prod"),
  jwtExpiresIn: optionalEnv("JWT_EXPIRES_IN", "7d"),
});
