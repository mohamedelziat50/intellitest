# IntelliTest

AI-powered VS Code extension for generating structured software test cases.

IntelliTest is a VS Code sidebar extension that helps developers and testers generate clean, structured test cases using an external AI model. It combines the user prompt with project context (detected stack and codebase file context), shows results in a table preview, recommends a testing framework, and supports Excel export.

## Features

- AI-powered test case generation
- VS Code sidebar UI
- Tech stack detection
- Excel export functionality
- Clean VS Code-native UI design

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

- `src/providers/IntelliTestViewProvider.ts`
  - Core backend view logic: prompt handling, AI generation flow, export flow, and webview messaging.

- `src/services/groq.ts`
  - AI API integration layer (Groq) and structured JSON parsing.

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
  - HTTP client for communicating with the backend `/generate-testcases` endpoint.
  - Maps server test case responses to UI-ready test case rows.

- `src/services/excel.ts`
  - Excel generation and file export using `xlsx`.

- `webview/`
  - Frontend sidebar UI assets.

- `webview/intellitest.html`
  - Sidebar layout and UI structure.

- `webview/intellitest.js`
  - Handles UI interactions and message passing with backend.

- `webview/intellitest.css`
  - VS Code-themed styling using theme variables.

- `package.json`
  - Extension manifest, contributions, scripts, and dependencies.

- `AI_CONTEXT.md`
  - Context file for AI tools and coding assistants.

Note: If you prefer naming like `webview/index.html`, `webview/script.js`, `webview/style.css`, this project currently uses `intellitest.html`, `intellitest.js`, and `intellitest.css` with the same roles.

## How It Works

1. User enters a prompt in the IntelliTest sidebar.
2. Extension detects the project tech stack.
3. **Codebase is scanned**: Static analysis extracts functions, classes, and variables from JS/TS files using the TypeScript Compiler API.
4. **Code context is built**: Project structure (routes, modules), code symbols, and detected priority files are packaged into a structured payload.
5. Request is sent to AI (Groq API) with prompt + comprehensive project context.
6. AI returns structured JSON test cases.
7. Results are displayed in the sidebar table preview with optional Excel export.

## Codebase Content Reading Feature

IntelliTest includes a **dual-layer code analysis engine** that combines **syntax extraction** (what code exists) with **semantic extraction** (what code means).

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
- **Displays Code Insights in sidebar** with collapsible file groups, category shading, and pagination (8 files/page)
- Shows function signatures and descriptions inline in the Code Insights panel
- **Prioritizes mentioned files**: When you write "passwordModal.js" in your prompt, symbols from that file are boosted to the top with full semantic information

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

**Efficient Extraction:** IntelliTest does NOT parse every character. Instead, it walks the AST tree, checking node types (`isFunctionDeclaration`, `isClassDeclaration`, etc.) and extracting only matched symbols with their metadata. A 1000-line file might yield only 5-10 functions—keeping context small and focused.

### File-by-File Breakdown

| File | Lines | Purpose |
|------|-------|---------|
| **codeInsights.ts** | 42-65 | `getJSDocDescription()` - reads `/** ... */` comments |
| **codeInsights.ts** | 67-80 | `buildFunctionSignature()` - reads TypeScript types |
| **codeInsights.ts** | 82-130 | `extractFromSourceFile()` - walks AST, combines both layers |
| **projectMap.ts** | 60-100 | `summarizeCodeInsightsForAi()` - formats for AI |
| **promptService.js** | Backend | Sends formatted code context to Groq LLM |

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

### Code Insights Panel

- Toggle "Code Insights" → see all functions + signatures + descriptions
- Click function → auto-add to prompt
- Browse 8 files/page with pagination

---

## AI Integration
- Requires `GROQ_API_KEY`.
- Backend builds system and user prompts, requests structured JSON, and normalizes responses.

### API Key Setup

Set your key before running:

- Environment variable: `GROQ_API_KEY`

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
  - `GROQ_API_KEY`
- Recommended:
  - Keep `.env` local and out of source control.
  - Ensure your debug launch configuration loads your environment values.

## Development Notes

- Uses VS Code Webview API for sidebar UI.
- Frontend and backend communicate through message passing.
- Async operations are handled with `async/await`.
- Build command:
  - `npm run compile`
