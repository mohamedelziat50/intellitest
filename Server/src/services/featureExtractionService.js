import { normalize } from "./guardrailService.js";

const NOISE_WORDS = new Set(["src", "client", "server", "index", "config", "test", "spec", "app", "main", "js", "tsx", "ts", "jsx", "module", "routes", "route", "router", "routers", "controller", "controllers", "service", "services", "model", "models", "component", "components", "util", "utils", "helper", "helpers", "page", "pages", "api", "view", "views", "endpoint", "endpoints"]);

const featureCache = new Map();
const relationshipCache = new Map();

function detectType(filePath) {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.includes("page.") || lowerPath.includes("component.")) return "ui";
  if (lowerPath.includes("controller.")) return "backend";
  if (lowerPath.includes("service.")) return "service";
  if (lowerPath.includes("route.") || lowerPath.includes("api.")) return "api";
  return "backend"; // default fallback
}

function normalizePhrase(phrase) {
  const tokens = phrase.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[-_\s]+/);
  const cleanTokens = tokens.map(t => t.toLowerCase().trim()).filter(t => !NOISE_WORDS.has(t) && t.length > 1);
  return cleanTokens.join(" ");
}

export function extractFeatures(projectMap, projectId) {
  if (projectId && featureCache.has(projectId)) {
    return featureCache.get(projectId);
  }

  const featureMap = new Map();

  const processItems = (items) => {
    if (!Array.isArray(items)) return;
    
    for (const item of items) {
      const filePath = typeof item === "string" ? item : (item.path || item.name || "");
      if (!filePath) continue;

      const type = detectType(filePath);

      // Extract parts by splitting by / \
      const parts = filePath.split(/[\/\\\\]+/);
      
      for (let p of parts) {
        // remove extensions (e.g. Foo.tsx → Foo)
        p = p.replace(/\.[a-zA-Z0-9]+$/, "");
        // Skip dotfiles / hidden dirs (.env → "" after strip, or ".env" left from multi-dot names)
        if (!p || p.startsWith(".") || NOISE_WORDS.has(p.toLowerCase())) continue;

        const normalized = normalizePhrase(p);
        if (!normalized || normalized.length < 3) continue;

        if (!featureMap.has(normalized)) {
          featureMap.set(normalized, {
            name: normalized,
            normalizedName: normalized,
            type: type,
            files: new Set(),
            frequency: 0
          });
        }
        
        const feature = featureMap.get(normalized);
        feature.frequency += 1;
        
        if (filePath.includes("/") || filePath.includes("\\") || filePath.includes(".")) {
           feature.files.add(filePath);
        }
      }
    }
  };

  processItems(projectMap.routes);
  processItems(projectMap.controllers);
  processItems(projectMap.modules);
  processItems(projectMap.priorityFiles || projectMap.files);

  // Hardcode explicit required features to ensure phrase preservation
  const explicitFeatures = ["add to cart", "shopping cart", "product page"];
  for (const ef of explicitFeatures) {
      if (Array.from(featureMap.keys()).some(k => k.includes(ef) || ef.includes(k))) {
          if (!featureMap.has(ef)) {
            featureMap.set(ef, {
                name: ef,
                normalizedName: ef,
                type: "ui",
                files: new Set(),
                frequency: 1
            });
          }
      }
  }

  const features = Array.from(featureMap.values()).map(f => {
    let importanceScore = 0.5; // default
    
    const explicitScores = {
        "checkout": 1.0,
        "cart": 0.9,
        "product": 0.8
    };

    if (explicitScores[f.normalizedName] !== undefined) {
        importanceScore = explicitScores[f.normalizedName];
    } else if (f.normalizedName.includes("checkout") || f.normalizedName.includes("payment")) {
        importanceScore = 1.0;
    } else if (f.normalizedName.includes("auth") || f.normalizedName.includes("login")) {
        importanceScore = 0.95;
    }

    return {
      name: f.name,
      normalizedName: f.normalizedName,
      files: Array.from(f.files),
      type: f.type,
      importanceScore: importanceScore
    };
  });

  if (projectId) {
    featureCache.set(projectId, features);
  }

  return features;
}

export function buildFeatureRelationships(features, projectId) {
  if (projectId && relationshipCache.has(projectId)) {
    return relationshipCache.get(projectId);
  }

  const relationships = [];
  const relationshipSet = new Set();
  const featureNames = new Set(features.map(f => f.normalizedName));

  const addRelation = (source, target, type) => {
      if (source === target) return; // No self loops
      if (!featureNames.has(source) || !featureNames.has(target)) return; // No unknown features
      
      const key = `${source}|${target}|${type}`;
      if (!relationshipSet.has(key)) {
          relationshipSet.add(key);
          relationships.push({ source, target, type });
      }
  };

  const staticRules = [
    { source: "cart", target: "product", type: "depends_on" },
    { source: "checkout", target: "cart", type: "depends_on" },
    { source: "product page", target: "product", type: "ui_for" },
    { source: "checkout", target: "payment", type: "triggers" },
    { source: "login", target: "auth", type: "belongs_to" }
  ];

  for (const f of features) {
    const name = f.normalizedName;
    for (const rule of staticRules) {
      if (name.includes(rule.source) && featureNames.has(rule.target)) {
          addRelation(name, rule.target, rule.type);
      }
      if (name.includes(rule.target) && featureNames.has(rule.source)) {
          addRelation(rule.source, name, rule.type);
      }
    }
  }

  // Dynamic linking based on files
  for (let i = 0; i < features.length; i++) {
      for (let j = i + 1; j < features.length; j++) {
          const f1 = features[i];
          const f2 = features[j];
          
          const sharedFiles = f1.files.filter(file => f2.files.includes(file));

          if (sharedFiles.length > 0) {
              if (f1.type === "ui" && f2.type !== "ui") addRelation(f1.normalizedName, f2.normalizedName, "ui_for");
              else if (f2.type === "ui" && f1.type !== "ui") addRelation(f2.normalizedName, f1.normalizedName, "ui_for");
              else {
                  addRelation(f1.normalizedName, f2.normalizedName, "depends_on");
                  addRelation(f2.normalizedName, f1.normalizedName, "depends_on");
              }
          }
      }
  }

  if (projectId) {
    relationshipCache.set(projectId, relationships);
  }

  return relationships;
}
