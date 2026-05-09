# IntelliTest Migration Guide: Groq -> Hugging Face (`Qwen2.5-Coder-7B-Instruct`)

This guide explains the migration end-to-end before any implementation changes.

---

## 1) Your Current Situation

From your codebase:

- AI requests are made from `src/services/groq.ts`
- Current endpoint is Groq OpenAI-compatible chat completions
- Current secret is `GROQ_API_KEY`
- Your extension expects structured JSON output and then normalizes it

So the migration is mainly:

1. Replace provider endpoint/model/auth
2. Keep your prompt + JSON parsing flow mostly intact
3. Rename config/env variables
4. Add provider-specific error handling and limits

---

## 2) Hugging Face Concepts (Important First)

Hugging Face gives you multiple ways to run the same model. This is what usually confuses first-time users:

### A) Serverless Inference API (easiest start)

- You call a Hugging Face hosted endpoint using an API key.
- No GPU setup by you.
- Good for quick integration, prototyping, and lower traffic.
- Can be slower and may have stricter rate limits depending on plan/model availability.

### B) Dedicated Inference Endpoints (production path)

- You deploy your own endpoint for a model on chosen hardware.
- Better reliability/latency consistency and control.
- Costs more because dedicated infra is reserved for you.

### C) Spaces / local / self-host

- Good for demos or custom hosting setups.
- More operational overhead.
- Usually not the fastest path for a VS Code extension team on first integration.

---

## 3) Do You Need an API Key?

Yes.

- For hosted Hugging Face API usage, you need a Hugging Face token.
- Keep it in environment variables (never hardcode).
- For your project, use backend `Server/.env` variables: `API_KEY`, `API_BASE_URL`, and `API_MODEL`.

Recommended token scope:

- Start with minimal read/inference permissions required for API calls.
- Rotate if exposed.

---

## 4) Do You Need to "Deploy" the Model?

Short answer: not at first.

Best first path:

1. Use Hugging Face hosted inference API for `Qwen2.5-Coder-7B-Instruct`
2. Validate quality/latency/cost with real prompts from IntelliTest
3. If needed, move to dedicated endpoint later

You only need "deployment" (dedicated endpoint) when you want:

- Predictable performance at scale
- Better SLAs/availability
- Stronger latency control

---

## 5) Cost and Free Options

Costs depend on which runtime you pick.

### Typical cost behavior

- Serverless inference: pay per usage / quota-limited by plan
- Dedicated endpoint: pay for provisioned compute uptime

### Is there a free way?

- Sometimes limited free inference credits/quota exist depending on account plan and model availability.
- Free tiers are usually best for testing, not dependable production extension traffic.

Practical recommendation:

1. Start with cheapest hosted option for validation
2. Add usage monitoring quickly
3. Move to dedicated only if latency/reliability requires it

---

## 6) Best Path for IntelliTest (Recommended Decision)

For your extension architecture, the best phased path is:

### Phase 1: Fast migration (recommended now)

- Keep your current service shape (`generateTestCases`)
- Swap provider from Groq to Hugging Face API
- Keep system prompt and JSON parser
- Add strict timeout + retries + clearer invalid-JSON handling

### Phase 2: Reliability improvements

- Add fallback model/provider path (optional)
- Add structured response validation before UI rendering
- Add telemetry on token/input length and response failures

### Phase 3: Scale optimization

- Benchmark quality and response time
- If needed, move to dedicated endpoint
- Optionally cache repeated requests

---

## 7) Compatibility Notes for `Qwen2.5-Coder-7B-Instruct`

This model is strong for code and instruction following, but in production you should still enforce:

- Response schema validation
- "JSON only" prompting guardrails
- Output repair/parsing fallback (you already have good base logic)

Why this matters:

- Any LLM can occasionally produce extra text around JSON.
- Your parser already handles fenced JSON and substring extraction, which is useful.

---

## 8) Security and Config Checklist

Before implementation:

1. Create Hugging Face token
2. Store in local environment (or `.env` loaded at runtime)
3. Never commit token
4. Update docs/config references from Groq to Hugging Face
5. Keep provider choice configurable if possible

Suggested backend env names (`Server/.env`):

- `API_KEY`
- `API_MODEL` (default: `Qwen/Qwen2.5-Coder-7B-Instruct`)
- `API_BASE_URL` (`https://router.huggingface.co/v1`)

---

## 9) Request/Response Design Advice for Your Extension

Because IntelliTest needs machine-parsable output, keep these rules:

- Keep system prompt explicit: "Return only valid JSON in exact schema"
- Keep user prompt assembly the same (tech stack + code context)
- Add max token/output limits to avoid runaway responses
- Keep your normalization layer (testCaseId fallback, step formatting, etc.)

This lets you swap providers with minimal impact on UI/export logic.

---

## 10) Latency, Rate Limits, and UX

In a VS Code sidebar UX, users feel delay quickly. Plan for:

- Request timeout (e.g., 30-60s)
- Retry once for transient 429/5xx
- User-friendly errors ("Model busy, retrying...")
- Loading state already exists in your UI, keep it explicit

---

## 11) Fine-Tuning: Do You Need It Now?

Not initially.

Based on your current product maturity, start with prompt engineering + schema enforcement first.

Fine-tuning (LoRA/PEFT) becomes useful when:

- You have many real failure examples
- You need domain-specific behavior repeatedly not solved by prompts
- You can evaluate improvements with clear metrics

Otherwise it adds complexity early.

---

## 12) Implementation Plan (When You Approve)

When you ask to proceed, implementation can be done in this order:

1. Add new Hugging Face service (or refactor current `groq.ts` into provider-agnostic service)
2. Replace endpoint/model/header auth logic
3. Rename env variable checks and error messages
4. Update any docs/config mentioning `GROQ_API_KEY`
5. Run compile + lint
6. Smoke test from extension UI prompt flow

---

## 13) Minimal Go-Live Checklist

- [ ] Hugging Face token created and stored securely
- [ ] Model ID confirmed (`Qwen2.5-Coder-7B-Instruct`)
- [ ] API call returns valid JSON in expected schema
- [ ] Error mapping tested (auth error, rate limit, invalid output)
- [ ] Extension generation and Excel export still work

---

## 14) Final Recommendation for You

Use Hugging Face hosted inference first with `Qwen2.5-Coder-7B-Instruct`, keep your current architecture, and focus on strict JSON enforcement and error handling.

This gives the fastest, lowest-risk migration path for IntelliTest. If usage grows or latency is inconsistent, then move to dedicated endpoint as phase 2/3.
