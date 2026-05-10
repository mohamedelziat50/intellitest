/**
 * Lightweight JSON body validation for Intilitest endpoints.
 */

export function validateProjectMap(req, res, next) {
  const b = req.body;
  if (!b || typeof b !== "object") {
    return res.status(400).json({ error: "Body must be a JSON object (Project Map)." });
  }
  const required = ["type", "language", "framework"];
  for (const k of required) {
    if (b[k] == null || String(b[k]).trim() === "") {
      return res.status(400).json({ error: `Missing or empty required field: ${k}` });
    }
  }
  if (b.modules != null && !Array.isArray(b.modules)) {
    return res.status(400).json({ error: "Field 'modules' must be an array when provided." });
  }
  if (b.routes != null && !Array.isArray(b.routes)) {
    return res.status(400).json({ error: "Field 'routes' must be an array when provided." });
  }
  if (b.testCases != null && !Array.isArray(b.testCases)) {
    return res.status(400).json({ error: "Field 'testCases' must be an array when provided." });
  }

  const prompt =
    b.prompt != null && String(b.prompt).trim() !== "" ? String(b.prompt).trim() : "";

  const testCases =
    Array.isArray(b.testCases) && b.testCases.length > 0
      ? b.testCases
          .slice(0, 50)
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const id = String(item.id ?? item.testCaseId ?? "").trim();
            const name = String(item.name ?? item.title ?? "Unnamed").trim() || "Unnamed";
            let steps = item.steps;
            if (typeof steps === "string") {
              steps = steps
                .split(/\n/)
                .map((s) => s.replace(/^\d+\.\s*/, "").trim())
                .filter(Boolean);
            }
            if (!Array.isArray(steps)) steps = [];
            return {
              id: id || undefined,
              name,
              steps: steps.map(String),
              expected: String(item.expected ?? item.expectedResult ?? ""),
              priority: item.priority != null ? String(item.priority) : "",
              preconditions: item.preconditions != null ? String(item.preconditions) : "",
            };
          })
          .filter(Boolean)
      : [];

  req.projectMap = {
    type: String(b.type),
    language: String(b.language),
    framework: String(b.framework),
    modules: Array.isArray(b.modules) ? b.modules.map(String) : [],
    routes: Array.isArray(b.routes) ? b.routes.map(String) : [],
    prompt,
    testCases,
  };
  next();
}

/**
 * POST /generate-test-code — body: { framework?: string, generateResponsePayload: object }.
 * generateResponsePayload should mirror POST /generate JSON (at minimum { testCases: [...] }).
 */
export function validateGenerateTestCode(req, res, next) {
  const b = req.body;
  if (!b || typeof b !== "object") {
    return res.status(400).json({
      source: "backend",
      type: "ValidationError",
      message: "Request body must be a JSON object.",
    });
  }

  const framework = b.framework != null ? String(b.framework).trim() : "";

  const payload = b.generateResponsePayload;
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return res.status(400).json({
      source: "backend",
      type: "ValidationError",
      message:
        "Field 'generateResponsePayload' must be a JSON object (typically the full body returned from POST /generate).",
    });
  }

  const tc = payload.testCases;
  if (!Array.isArray(tc) || tc.length === 0) {
    return res.status(400).json({
      source: "backend",
      type: "ValidationError",
      message: "generateResponsePayload.testCases must be a non-empty array.",
    });
  }

  if (tc.length > 100) {
    return res.status(400).json({
      source: "backend",
      type: "ValidationError",
      message: "Too many test cases (max 100 per request).",
    });
  }

  req.generateTestCodeBody = { framework, generateResponsePayload: payload };
  next();
}

export function validateAnalyzeFailure(req, res, next) {
  const b = req.body;
  if (!b || typeof b !== "object") {
    return res.status(400).json({ error: "Body must be a JSON object." });
  }
  if (b.error == null || String(b.error).trim() === "") {
    return res.status(400).json({ error: "Field 'error' is required." });
  }
  req.failurePayload = {
    error: String(b.error),
    test: b.test != null ? String(b.test) : "",
  };
  next();
}
