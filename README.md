# Debuggo

AI-powered VS Code extension for generating structured software test cases.

Debuggo is a VS Code sidebar extension that helps developers and testers generate clean, structured test cases using an external AI model. It combines the user prompt with project context (detected stack and codebase file context), shows results in a table preview, recommends a testing framework, and supports Excel export.

---

## Important: local API server

To use **your own** Groq key, MongoDB, and quotas, run the **`Server`** on your machine—not the hosted Render deployment.

1. **Install dependencies (two places)**  
   - From the **repository root**: `npm install` (extension build / VS Code tooling).  
   - From **`Server/`**: `cd Server` then `npm install` (Express API).

2. **Configure the server**  
   Copy `Server/.env.example` → **`Server/.env`**, then set **`MONGODB_URI`**, **`JWT_SECRET`**, **`LLM_PROVIDER=api`**, and **`API_KEY`** or **`GROQ_API_KEY`** (and **`API_MODEL`** if you change the model).

3. **Start the API**  
   ```bash
   cd Server
   npm run dev
   ```  
   (`dev` runs the server with **Node `--watch`**; use **`npm start`** if you prefer a single run without watch.) Default HTTP port is **`3000`** (see **`PORT`** in `Server/.env`).

4. **Point the extension at localhost (`package.json` only — no VS Code Settings UI)**  
   Open **`package.json`** at the repo root → **`contributes`** → **`configuration`** → **`properties`** → **`debuggo.backendUrl`**, and set:
   ```json
   "default": "http://localhost:3000"
   ```
   Use the same host/port as your running Server (no trailing slash; match **`PORT`** in `Server/.env` if it is not `3000`).

   **Do not `git commit` or `git push` this change.** Revert `default` back to the hosted Render URL (`https://intellitest-hyvw.onrender.com`) before you push, so GitHub CI / deployments and everyone else cloning the repo do not inherit a localhost-only backend and fail. Same rule for any fork you open PRs against: **local edit only**.

   Leaving `default` as the **hosted** URL means the extension talks to **Render** (`Server/.env` on your laptop is unused for those requests—you share that deployment’s Groq org and quotas).

---

## Features

- AI-powered test case generation (and optional **Generate code** → **Generated code** panel in the sidebar)
- VS Code sidebar UI with collapsible sections (test cases, code insights, generated script)
- **Code insights**: AST-derived symbols per file, collapsible file rows with animated expand, compact Prev/Next pagination
- Compact example prompt chips (**Try …**) when the workspace is idle
- Optional sidebar sign-in (JWT) for per-account history; usable as **guest** when the backend URL is set
- Tech stack detection
- Excel export functionality
- Clean VS Code–native styling (theme tokens via `webview/debuggo.css`)

## Demo / Preview

Add screenshots here:

- Sidebar overview
- Generated test case table preview
- Export success flow

## Installation

1. Clone the repository.
2. Install dependencies:
   `npm install`
3. Open the project in VS Code.
4. Press `F5` to run the extension in an Extension Development Host window.

## Project Structure

Key files and folders:

- `src/extension.ts`
  - Extension activation and registration of the webview provider.
  - Main backend entrypoint for VS Code integration.

- `src/providers/DebuggoViewProvider.ts`
  - Core backend view logic: prompt handling, AI generation flow, export flow, and webview messaging.

- `src/services/groq.ts`
  - AI API integration layer (Groq OpenAI-compatible API) and structured JSON parsing.

- `src/services/techStack.ts`
  - Detects project technology stack from workspace files.

- `src/services/codebaseContext.ts`
  - Builds codebase context from scanned project file names.

- `src/services/codeInsights.ts`
  - Static AST-based code symbol extraction for JS/TS files.
  - Parses files using TypeScript Compiler API to extract functions (with parameters), classes (with methods), variables, and imports.
  - Analyzes up to 200KB per file; skips unsupported file types.

- `src/services/projectMap.ts`
  - Builds lightweight structured context payload for AI generation.
  - Detects file names mentioned in user prompts and prioritizes those files in the code insights.
  - Combines tech stack, routes, modules, and code symbols into a single payload sent to the backend.

- `src/services/backendClient.ts`
  - HTTP client for the IntelliTest API (`POST /generate`, `/analyze-intent`, `/project/...`).
  - Sends `Authorization: Bearer` when the user is logged in so history is stored **per account + workspace projectId**.
  - Maps server test case responses to UI-ready test case rows.

- `src/services/authSession.ts`
  - Calls `/auth/login` and `/auth/signup`, persists JWT in VS Code SecretStorage.

- `Server/` (optional but required for gated extension flow)
  - Express + MongoDB backend with `/auth/*` and stateful generation routes (`Server/src/app.js`).

- `src/services/excel.ts`
  - Excel generation and file export using `xlsx`.

- `webview/`
  - Frontend sidebar UI assets.

- `webview/debuggo.html`
  - Sidebar layout and UI structure.

- `webview/debuggo.js`
  - Handles UI interactions and message passing with backend.

- `webview/debuggo.css`
  - VS Code-themed styling using theme variables.

- `package.json`
  - Extension manifest, contributions, scripts, and dependencies.

- `AI_CONTEXT.md`
  - Context file for AI tools and coding assistants.

Note: If you prefer naming like `webview/index.html`, `webview/script.js`, `webview/style.css`, this project currently uses `debuggo.html`, `debuggo.js`, and `debuggo.css` with the same roles.

## How It Works

1. User enters a prompt in the Debuggo sidebar.
2. Extension detects the project tech stack.
3. **Codebase is scanned**: Static analysis extracts functions, classes, and variables from JS/TS files using the TypeScript Compiler API.
4. **Code context is built**: Project structure (routes, modules), code symbols, and detected priority files are packaged into a structured payload.
5. Request is sent to AI (Groq or configured OpenAI-compatible API) with prompt + comprehensive project context.
6. AI returns structured JSON test cases.
7. Results are displayed in the sidebar table preview with optional Excel export.

## Codebase Content Reading Feature

Debuggo includes a **dual-layer code analysis engine** that combines **syntax extraction** (what code exists) with **semantic extraction** (what code means).

### Two-Layer Analysis

**Layer 1: Syntax Layer** (Structure)
- Scans JS/TS files in your project workspace (respecting `.gitignore` and common ignore patterns)
- Uses TypeScript Compiler API to parse AST and extract:
  - Function names and parameters
  - Class names and methods
  - Variable names and exports
  - Import statements

**Layer 2: Semantic Layer** (Meaning)
- Extracts from AST to understand *intent*:
  - **TypeScript type signatures**: Shows parameter types, return types (e.g., `(password: string): boolean`)
  - **JSDoc descriptions**: Captures function purpose from comments (e.g., "Validates password strength")
  - This layer enables AI to understand *what the code should do*, not just *what exists*

### What It Does

- Combines structure + meaning into rich code context for AI
- **Displays Code insights in the sidebar** with collapsible per-file rows (`<details>`), a CSS grid drawer animation for expand/collapse, category blocks (`Functions`, `Variables`, …) with shaded borders, and **compact pagination**: a small number of files per page (`INSIGHTS_PAGE_SIZE` in `webview/debuggo.js`, default **4**) with **Prev** / **Page N of M** / **Next** — not a long grid of page numbers
- The insights panel height is capped (`insights-panel`) so **Generated code** stays easier to reach on tall symbol lists
- Shows function signatures (and descriptions when JSDoc exists) inline in Code insights
- **Prioritizes mentioned files**: When you write `passwordModal.js` in your prompt, symbols from that file are boosted toward the front of the AI context with full semantic information

### How It Works (Enhanced Flow with Semantic Layer)

```
User writes prompt (e.g., "Test passwordModal.js validation")
        ↓
┌─ SYNTAX LAYER (Structure) ─────────────────┐
│ Code scanner finds all JS/TS files         │
│ AST parser extracts structure:              │
│ - Function names, parameters                │
│ - Class names, methods                      │
│ - Variables, imports                        │
└────────────────────────────────────────────┘
        ↓
┌─ SEMANTIC LAYER (Meaning) ──────────────────┐
│ Extract from AST:                           │
│ - TypeScript type signatures (inputs/outputs)│
│ - JSDoc descriptions (purpose/intent)       │
│ Example: validatePassword(password: string, │
│   minLength: number): boolean               │
│   "Validates password strength"             │
└────────────────────────────────────────────┘
        ↓
⭐ File priority detection: "passwordModal.js" detected → move to top
        ↓
Code symbols shown in sidebar Code Insights panel
(includes signatures + descriptions)
        ↓
Prioritized semantic context sent to AI:
  - Project type, tech stack, framework
  - Routes and modules
  - Code symbols with types & purpose (prioritized first)
  - User prompt
        ↓
AI interprets meaning:
  • Type signature → what inputs/outputs are valid
  • Description → what should it do
  • Generate happy-path + edge-case tests
        ↓
AI generates focused, semantically-aware test cases
```

### What Gets Sent to AI (Syntax + Semantic Context)

The AI receives a structured project map containing:

| Component | Example | Purpose |
|-----------|---------|----------|
| **File Names** | `src/modals/passwordModal.js`, `src/services/auth.ts` | Understand project organization |
| **Syntax Layer** | Functions: `validatePassword`, `resetForm`; Classes: `PasswordValidator`; Variables: `MIN_LENGTH` | Basic code structure |
| **Semantic Layer** | `validatePassword(password: string, minLength: number): boolean - "Validates password strength"` | **AI understands inputs/outputs (types) and purpose (description)** |
| **Priority Files** | `["passwordModal.js"]` (detected from prompt) | Focus AI generation on user-specified files with full semantic context |
| **Framework/Language** | React, Vue, Express, JavaScript, TypeScript | Use appropriate testing patterns |
| **Project Structure** | Routes, modules, API endpoints | Understand application architecture |

**Semantic Layer Impact:** Type signatures (e.g., `: boolean`, `: Promise<AuthToken>`) + descriptions (e.g., "Validates strength") allow AI to generate tests that match actual code behavior.

### Example Code Context Sent to AI (With Semantic Layer)

**UI Display (Code Insights Panel):**
```
⭐ src/modals/passwordModal.js
  Functions:
    validatePassword(password: string, minLength: number): boolean
    resetForm(formRef: HTMLFormElement): void
    handleSubmit(event: SubmitEvent, callback: Function): Promise<void>
  Classes: PasswordValidator
  Variables: MIN_LENGTH, REGEX_PATTERN
```
*(Shows signatures only; descriptions only appear if JSDoc comments exist)*

**What Gets Sent to AI (Behind the scenes):**
```
validatePassword(password: string, minLength: number): boolean - Validates password strength
resetForm(formRef: HTMLFormElement): void - Clears form and resets state
...
```
*(Type signatures + JSDoc descriptions, even if not displayed in UI)*

**How AI Uses This:**
- `validatePassword(password: string, minLength: number): boolean` tells AI: *takes 2 inputs (text + number), returns true/false*
- `"Validates password strength"` tells AI: *purpose is strength validation, so test weak passwords, edge cases, special chars*
- Result: AI generates tests like "Test with password under min length", "Test with special characters", etc.

The **⭐** symbol marks priority files; **type signatures** are always visible in UI; **descriptions** are sent to AI but not displayed in UI (unless JSDoc exists).


## Where Syntax & Semantic Layers Happen

**In One Picture:**
```
File Read
  ↓
Parse into AST (Abstract Syntax Tree)
  ↓
├─ SYNTAX LAYER: Extract structure
│  File: src/services/codeInsights.ts (lines 82-130)
│  Function: extractFromSourceFile()
│  Extracts: function names, parameters, classes, variables
│
└─ SEMANTIC LAYER: Add meaning
   File: src/services/codeInsights.ts (lines 42-80)
   Functions: getJSDocDescription() + buildFunctionSignature()
   Extracts: JSDoc comments + TypeScript types
  ↓
Combined Result:
  validatePassword(password: string, minLength: number): boolean
  - "Validates password strength"
  ↓
Sent to AI for smarter test generation
```

**Efficient Extraction:** Debuggo does NOT parse every character. Instead, it walks the AST tree, checking node types (`isFunctionDeclaration`, `isClassDeclaration`, etc.) and extracting only matched symbols with their metadata. A 1000-line file might yield only 5-10 functions—keeping context small and focused.

### File-by-File Breakdown

| File | Lines | Purpose |
|------|-------|---------|
| **codeInsights.ts** | 42-65 | `getJSDocDescription()` - reads `/** ... */` comments |
| **codeInsights.ts** | 67-80 | `buildFunctionSignature()` - reads TypeScript types |
| **codeInsights.ts** | 82-130 | `extractFromSourceFile()` - walks AST, combines both layers |
| **projectMap.ts** | 60-100 | `summarizeCodeInsightsForAi()` - formats for AI |
| **promptService.js** | Backend | Sends formatted code context to the configured LLM (Groq when using default API settings) |

### What Gets Extracted (Simple)

**SYNTAX LAYER (What code exists):**
- Function name: `validatePassword`
- Parameters: `password`, `minLength`
- Class name: `PasswordValidator`

**SEMANTIC LAYER (What it means):**
- Parameter types: `string`, `number`
- Return type: `boolean`
- Purpose: `"Validates password strength"`

**Result for AI:**
```
validatePassword(password: string, minLength: number): boolean - Validates password strength
```

---



**JSDoc** is structured comments that explain what code does.

### Quick Explanation

```javascript
/**
 * One-line description
 * @param {type} name - what it is
 * @returns {type} what it returns
 */
```

**Real example:**
```javascript
/**
 * Validates password strength.
 * @param {string} password - password to check
 * @param {number} minLength - minimum length
 * @returns {boolean} true if valid
 */
function validatePassword(password, minLength) { }
```

### Impact: With vs Without

| Without JSDoc | With JSDoc |
|---|---|
| `validatePassword(password: string, number): boolean` | `validatePassword(...): boolean - Validates strength` |
| AI generates generic tests | AI generates: weak passwords, edge cases, special chars |

### Code insights panel (UI)

- Toggle **Code insights** to expand or collapse the section
- Each file is a row; open it to see symbols (functions are buttons that **prefill the prompt**)
- Use **Prev** / **Next** and the **Page N of M** label to move through files (page size is `INSIGHTS_PAGE_SIZE` in `webview/debuggo.js`)
- **Refresh** re-fetches symbol data from the extension (resets to page 1)

---

## AI Integration
- Requires backend AI config in `Server/.env`.
- Backend builds system and user prompts, requests structured JSON, and normalizes responses.

### API Key Setup

Set your key before running in `Server/.env` (based on `Server/.env.example`):

- `LLM_PROVIDER=api`
- `API_BASE_URL=https://api.groq.com/openai/v1` (optional; this is the default in config when unset)
- `API_KEY=<your_groq_api_key>` (or `GROQ_API_KEY`)
- `API_MODEL=llama-3.3-70b-versatile` (or another [Groq model](https://console.groq.com/docs/models))

For local VS Code debugging, `.vscode/launch.json` can load environment variables from `.env`.

## Excel Export

- Uses `xlsx` library.
- Generates `.xlsx` files locally.
- Output filename format includes timestamp, for example:
  - `test_cases_DD-MM-YY_HH-MM-SS.xlsx`
- Export includes columns:
  - Test Case ID
  - Title
  - Description
  - Preconditions
  - Steps
  - Expected Result
  - Priority

## Configuration

- Required:
  - `Server/.env` with valid `API_KEY` or `GROQ_API_KEY`
- Recommended:
  - Keep `.env` local and out of source control.
  - Ensure your debug launch configuration loads your environment values.

## Sidebar authentication

The **extension sidebar** is separate from any **browser** demo under `website/`.

1. The extension must reach a running API URL. The shipped default lives in **`package.json`** (`debuggo.backendUrl` under `contributes.configuration.properties`). For a **local** Server, temporarily set that **`default`** to `http://localhost:3000` as in **Important: local API server** (and **do not push** that edit). Without a reachable URL, generation stays disabled.
2. Open the Debuggo sidebar: the **full workspace UI** is visible (**guest-first**). Use header **Sign in** to open the optional **Account** card (Log in / Sign up). Close with **×**, **Escape**, or automatically after a successful login.
3. Signing in is **optional**: guests can generate when the backend is reachable. After login, JWT is stored in VS Code SecretStorage (`intellitest.authJwt`); restart keeps you signed in until **Log out**, token expiry (`JWT_EXPIRES_IN`, often 7 days), or server rejection (401).

The header shows **Sign in** when logged out and **Log out** when authenticated; signed-in accounts may show a display label (`userLabel`).

## How to test (auth + generation)

1. **MongoDB**: Run a local MongoDB instance (or Atlas URI) matching `Server/.env`.
2. **Server**: From the repo root, `cd Server && npm install && npm start` (or your process manager).
3. **Extension host**: From the repo root, `npm install && npm run compile`, then press **F5** in VS Code with the extension project open (**Run Extension**).
4. In the Extension Development Host, the backend URL comes from **`package.json`**’s **`debuggo.backendUrl` `default`** (see step 4 under **Important: local API server**). For localhost, edit that field locally—**do not commit/push**.
5. **Sign up** (optional): Open **Sign in** → **Sign up**, then name (if shown), email, and password ≥ 8 characters. On success the Account panel closes and header shows **Log out** (`init`, code insights, etc. behave as authenticated).
6. **Persistence**: Reload (**Developer: Reload Window**) or restart the host; with a valid JWT you should reopen the sidebar still signed in (header **Log out**).
7. **Log out**: Click **Log out**; JWT is cleared and **Sign in** returns — main generator UI stays available for guests when backend URL is set.
8. **Generation + history**: After sign-in, run **Generate** once; reopen the sidebar or trigger **Retry** reload—`sessionLoaded` is posted (history is available for a future sidebar UI); server stores messages under your user plus the workspace project UUID.
9. **Backend down**: Stop the server, reload the sidebar: bootstrap error messaging and optional **Retry** on the Account flow / banners as implemented (stored token handling depends on `/auth/me` response).
10. **Expired token**: Set `JWT_EXPIRES_IN` short (for example `10s`), restart server, wait, then trigger **Generate** or reload; extension should recover guest or re-auth UX per current webview messaging (banner / gate form), without assuming a full-screen-only gate.

11. **Code insights paging**: Use **Next** repeatedly on a large repo; paging should advance by one page at a time (delegated clicks — regressions caused by duplicate handlers would skip pages).

12. **Account panel**: **Escape** closes the Account card while it is open.

## Development Notes

- Uses VS Code Webview API for sidebar UI.
- Frontend and backend communicate through message passing.
- Async operations are handled with `async/await`.
- Build command:
  - `npm run compile`
