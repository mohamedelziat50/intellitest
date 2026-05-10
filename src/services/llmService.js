/**
 * LLM adapter: Ollama (local) or OpenAI-compatible HTTP API. Configured via env.
 */
import axios from "axios";
import { logger } from "../utils/logger.js";

function getConfig() {
  const provider = (process.env.LLM_PROVIDER || "ollama").toLowerCase();
  return {
    provider,
    ollamaBase: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    ollamaModel: process.env.OLLAMA_MODEL || "llama3.2",
    apiBase: process.env.API_BASE_URL || "https://api.groq.com/openai/v1",
    apiKey: (process.env.API_KEY || process.env.GROQ_API_KEY || "").trim(),
    apiModel: process.env.API_MODEL || "llama-3.3-70b-versatile",
  };
}

/**
 * @param {string} prompt - full user/system prompt text
 * @returns {Promise<string>} raw model text
 */
export async function complete(prompt) {
  const cfg = getConfig();
  if (cfg.provider === "api") {
    return completeOpenAICompatible(cfg, prompt);
  }
  return completeOllama(cfg, prompt);
}

async function completeOllama(cfg, prompt) {
  const url = `${cfg.ollamaBase.replace(/\/$/, "")}/api/chat`;
  const body = {
    model: cfg.ollamaModel,
    messages: [{ role: "user", content: prompt }],
    stream: false,
  };
  try {
    const { data } = await axios.post(url, body, { timeout: 120_000 });
    const text = data?.message?.content ?? data?.response ?? "";
    return typeof text === "string" ? text : JSON.stringify(text);
  } catch (e) {
    logger.error("ollama_request_failed", { message: e.message, url });
    throw new Error(`Ollama request failed: ${e.message}`);
  }
}

async function completeOpenAICompatible(cfg, prompt) {
  if (!cfg.apiBase || !cfg.apiKey) {
    throw new Error("API_BASE_URL and API_KEY (or GROQ_API_KEY) are required when LLM_PROVIDER=api");
  }
  const base = cfg.apiBase.replace(/\/$/, "");
  const url = `${base}/chat/completions`;
  const body = {
    model: cfg.apiModel,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
  };
  try {
    const { data } = await axios.post(url, body, {
      timeout: 120_000,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    const choice = data?.choices?.[0]?.message?.content;
    return typeof choice === "string" ? choice : JSON.stringify(choice ?? "");
  } catch (e) {
    const status = e.response?.status;
    logger.error("api_llm_request_failed", { message: e.message, status });
    throw new Error(`LLM API request failed: ${e.message}`);
  }
}
