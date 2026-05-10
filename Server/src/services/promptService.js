import { loadPrompt, fillPrompt } from "../utils/promptLoader.js";

function projectContextBlock(map) {
  const lines = [
    "Project context (structured):",
    `- language: ${map.language || "unknown"}`,
    `- framework: ${map.framework || "unknown"}`
  ];

  // 🔥 FIX: We now inject the highly accurate AST Code Insights directly into the prompt.
  // We completely removed the generic "routes" and "modules" arrays because they 
  // bloated the prompt with garbage files.
  if (map.codeInsights) {
    lines.push("\n[Target Project File Context - AST Code Insights]:");
    for (const [file, insights] of Object.entries(map.codeInsights)) {
      lines.push(`- ${file}: ${insights}`);
    }
  }

  return lines.join("\n");
}

export function detectFeaturesPrompt(projectMap) {
  const template = loadPrompt("detectFeatures.txt");

  return fillPrompt(template, {
    CODEBASE_SUMMARY: projectContextBlock(projectMap),
  });
}

function priorityFilesBlock(map) {
  if (!Array.isArray(map.priorityFiles) || map.priorityFiles.length === 0) {
    return "";
  }

  return `\nPRIORITY FILES (focus test cases here first):\nThe tester specifically mentioned these files as focus areas. Generate test cases that exercise their functions, classes, and variables:\n${map.priorityFiles
    .map((f) => `- ${f}`)
    .join("\n")}`;
}

export function generateTestCasesPrompt(projectMap, matchResult, restrictInstruction) {
  const ctx = projectContextBlock(projectMap);
  const priorityCtx = priorityFilesBlock(projectMap);

  const testerAsk =
    projectMap.prompt && String(projectMap.prompt).trim()
      ? `\n\nTester request:\n${String(projectMap.prompt).trim()}\n`
      : "";

  const restrictions = restrictInstruction ? `\n\nCRITICAL SCOPE RESTRICTION:\n${restrictInstruction}\n` : "";

  // Detect if the user wants an E2E/Flow test from the prompt
  const isFlowTest = projectMap.prompt && /flow|e2e|integration|process|end to end/i.test(projectMap.prompt);
  const taskDescription = isFlowTest
    ? "Propose comprehensive end-to-end (e2e) test cases that cover critical user flows and integrations for this system."
    : "Propose manual test cases that cover critical user flows and edge cases for this system.";

  return `You are a senior QA engineer. ${ctx}${priorityCtx}${testerAsk}${restrictions}

Task: ${taskDescription}

Rules:
- Output ONLY valid JSON (no markdown, no commentary).
- Return a JSON array of objects. Each object MUST have: "id", "name", "description", "preconditions", "steps", "expected", "comments".
- Also include "priority": one of "critical", "high", "medium", "low".
- Include "tags": array of short labels.
- Keep "description" as a human-readable scenario summary.
- Keep "preconditions" concrete.
- If priority files were specified, emphasize test cases that exercise those files first.
- Order the array so critical items appear first.

Example shape:
[{"id":"TC-001","name":"...","description":"...","preconditions":"...","steps":["..."],"expected":"...","priority":"critical","tags":["auth"],"comments":"..."}]`;
}

export function generateTestScriptsPrompt(projectMap) {
  const template = loadPrompt("generateTestScripts.txt");

  const lang = (projectMap.language || "").toLowerCase();
  const fw = (projectMap.framework || "").toLowerCase();

  let framework = "jest";
  let language = "javascript";
  let filename = "generated.test.js";

  if (lang.includes("python")) {
    framework = "pytest";
    language = "python";
    filename = "test_generated.py";
  } else if (lang.includes("java") || fw.includes("spring")) {
    framework = "junit";
    language = "java";
    filename = "GeneratedTest.java";
  }

  const testCasesBlock =
    Array.isArray(projectMap.testCases) && projectMap.testCases.length > 0
      ? JSON.stringify(projectMap.testCases, null, 2)
      : "[]";

  const testerAsk =
    projectMap.prompt && String(projectMap.prompt).trim()
      ? String(projectMap.prompt).trim()
      : "No extra tester request provided.";

  return fillPrompt(template, {
    PROJECT_CONTEXT: projectContextBlock(projectMap),
    TEST_CASES: testCasesBlock,
    FRAMEWORK: framework,
    LANGUAGE: language,
    FILENAME: filename,
    TESTER_REQUEST: testerAsk,
  });
}

export function analyzeFailurePrompt(payload) {
  const template = loadPrompt("analyzeFailure.txt");

  return fillPrompt(template, {
    FAILURE_OUTPUT: payload.error ?? "",
    TEST_NAME: payload.test ?? "",
  });
}

/**
 * Executable test code from structured cases. Embeds the full prior-generation JSON
 * (POST /generate response body) so the model stays aligned with the same scenarios.
 *
 * @param {string} frameworkHint
 * @param {Record<string, unknown>} generateResponsePayload
 * @returns {string}
 */
export function generateExecutableTestCodePrompt(frameworkHint, generateResponsePayload) {
  const jsonBlock = JSON.stringify(generateResponsePayload ?? {}, null, 2);
  const fw =
    frameworkHint && String(frameworkHint).trim() && !/not (detected|generated|specified)/i.test(frameworkHint)
      ? String(frameworkHint).trim()
      : "Infer the best matching test runner from the JSON and project hints.";

  return `You are a senior QA automation engineer.

The JSON below is the exact structured output from the prior manual test-case generation step (LLM via POST /generate), including its "testCases" array and any metadata fields (meta, features, insights, etc.). Treat this JSON as the single source of truth for what to automate.

PRIOR_GENERATION_JSON:
${jsonBlock}

Target testing framework hint: ${fw}

Task: Generate executable automated test code that implements these scenarios.
Rules:
- Use clear test names, setup, actions, expected results, and assertions.
- Generate clean, complete, runnable code.
- Return only the raw source code — no markdown, no code fences, no explanation before or after the code.`;
}