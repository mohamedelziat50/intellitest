# IntelliTest + OpenRouter — Full setup (platform + code + usage)

This guide is **concrete**: exact URLs, env variable names, and what to watch for. The backend uses **OpenAI-compatible** `POST …/chat/completions`; OpenRouter supports that.

---

## Part A — OpenRouter platform (step by step)

### 1. Create account

1. Open [https://openrouter.ai/](https://openrouter.ai/)
2. Sign up (email / GitHub / Google — whatever you prefer).

### 2. Create an API key

1. Go to [https://openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)
2. Click **Create key** (wording may vary).
3. Copy the key immediately and store it safely. It usually looks like `sk-or-v1-…` (exact prefix can change).
4. **Never commit it** to git. Only put it in `Server/.env` (local file, gitignored).

### 3. Add credits (if you use paid models)

1. OpenRouter billing / credits: [https://openrouter.ai/docs/faq](https://openrouter.ai/docs/faq) and [https://openrouter.ai/credits](https://openrouter.ai/credits) (use whatever “Credits” / “Billing” link exists in your logged-in UI).
2. **Free models** exist but are **not unlimited** — see [rate limits FAQ](https://openrouter.ai/docs/faq#how-are-rate-limits-calculated).

### 4. Pick a model and copy its **exact** id

1. Open the model directory: [https://openrouter.ai/models](https://openrouter.ai/models)
2. Filter or search for **Qwen** (or any model you want).
3. Open the model page. Copy the **model id** shown for the API (often like `qwen/qwen2.5-coder-7b-instruct` or `…:free` for free tiers).
4. Paste that string **verbatim** into `API_MODEL` in `Server/.env`.

**Critical:** OpenRouter model ids are **not** the same as Hugging Face repo paths. Always copy from OpenRouter’s UI.

### 5. (Optional) Attribution headers

OpenRouter’s docs recommend optional headers for app attribution (leaderboards):

- `HTTP-Referer` — your app or repo URL  
- `X-OpenRouter-Title` — short app name  

IntelliTest reads these from env when the base URL is OpenRouter:

- `OPENROUTER_HTTP_REFERER`
- `OPENROUTER_APP_TITLE`

They are **optional** — the API works without them.

Reference: [OpenRouter quickstart](https://openrouter.ai/docs/quickstart)

---

## Part B — IntelliTest backend configuration

### 1. Copy env template

```text
Server/.env.example  →  Server/.env
```

Edit **`Server/.env`** (not `.example`).

### 2. Set these four lines for OpenRouter

| Variable | Exact value / rule |
|---------|---------------------|
| `LLM_PROVIDER` | `api` |
| `API_BASE_URL` | `https://openrouter.ai/api/v1` (**no trailing slash**) |
| `API_KEY` | Your OpenRouter key from settings |
| `API_MODEL` | The **exact** model id from OpenRouter model page |

**Why this base URL?** Our code builds:

`API_BASE_URL` + `/chat/completions`

So full URL becomes:

`https://openrouter.ai/api/v1/chat/completions`

which matches [OpenRouter’s documented endpoint](https://openrouter.ai/docs/quickstart).

### 3. Timeouts

Large prompts (big `projectMap`) can exceed 30s. In `Server/.env.example` we default `AI_TIMEOUT_MS=120000` for that reason. Adjust if needed.

### 4. Restart backend

```powershell
cd C:\Users\MH\Desktop\intellitest\Server
npm run dev
```

### 5. Extension points at the same server

In VS Code **Settings**, set `intellitest.backendUrl` to your backend, e.g. `http://localhost:3000` (must match `PORT` in `Server/.env`).

---

## Part C — What we changed in code (this branch)

1. **`Server/src/config.js`**  
   - Added optional `OPENROUTER_HTTP_REFERER` and `OPENROUTER_APP_TITLE` for OpenRouter attribution.

2. **`Server/src/ai/aiService.js`**  
   - When `API_BASE_URL` contains `openrouter.ai`, requests include those optional headers if set.  
   - Same `POST` body as before: `model`, `messages`, `temperature`.

3. **`Server/.env.example`**  
   - Defaults and comments for OpenRouter; Groq left as commented alternative.

No change is required in the VS Code extension for OpenRouter **if** you already use the backend `/generate` flow.

---

## Part D — Usage, limits, and what to take care of

### Rate limits and “free”

- **Not unlimited.** Limits depend on your account, purchased credits, and model.  
- Read: [OpenRouter FAQ — rate limits](https://openrouter.ai/docs/faq#how-are-rate-limits-calculated)

### Cost

- Paid models charge per **tokens** (input + output). Large `projectMap` = more input tokens = higher cost.
- Monitor usage in the OpenRouter dashboard.

### Privacy

- Project context is sent to OpenRouter’s chosen model provider according to their routing. Do not send secrets in prompts.

### JSON output

- Your backend expects the model to return **valid JSON** matching the prompt schema. Some models drift; if you see “malformed output” errors, try another model or tighten prompts later.

### Security

- Keep `API_KEY` only in `Server/.env` on the machine that runs the backend.  
- Do not expose the backend to the public internet without authentication and HTTPS in production.

---

## Part E — Quick verification (curl)

Replace `YOUR_KEY` and `YOUR_MODEL_ID`:

```powershell
curl.exe -s -X POST "https://openrouter.ai/api/v1/chat/completions" `
  -H "Authorization: Bearer YOUR_KEY" `
  -H "Content-Type: application/json" `
  -d "{\"model\":\"YOUR_MODEL_ID\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with only this JSON: {\\\"ok\\\":true}\"}]}"
```

If you see `choices[0].message.content`, OpenRouter + key + model id are correct; then IntelliTest should work with the same `API_BASE_URL`, `API_KEY`, and `API_MODEL`.

---

## Summary checklist

- [ ] OpenRouter account + API key  
- [ ] Model id copied from [openrouter.ai/models](https://openrouter.ai/models)  
- [ ] `Server/.env` has `LLM_PROVIDER=api`, correct `API_BASE_URL`, `API_KEY`, `API_MODEL`  
- [ ] Optional: `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_TITLE`  
- [ ] Backend restarted; extension `backendUrl` matches server  
- [ ] Understand limits and cost for your chosen model  
