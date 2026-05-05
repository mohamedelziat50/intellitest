import { normalize } from "./guardrailService.js";

const SYNONYMS = {
  "buy": ["checkout", "order", "payment"],
  "purchase": ["checkout", "order", "payment"],
  "add": ["cart"],
  "basket": ["cart"],
  "item": ["product"],
  "pay": ["payment", "checkout"],
  "sign in": ["login", "auth"],
  "sign up": ["register", "auth"]
};

const BOOSTS = {
  "checkout": 1.0,
  "payment": 1.0,
  "auth": 0.95,
  "cart": 0.9,
  "product": 0.8
};

function scoreMatch(promptTokens, featureTokens) {
  let score = 0;
  for (const ft of featureTokens) {
    if (promptTokens.includes(ft)) {
      score += 1.0; // exact match
      continue;
    }
    
    let matched = false;
    for (const [key, syns] of Object.entries(SYNONYMS)) {
       if ((ft === key && promptTokens.some(pt => syns.includes(pt))) ||
           (syns.includes(ft) && promptTokens.includes(key))) {
           score += 0.7; // synonym
           matched = true;
           break;
       }
    }
    if (matched) continue;

    for (const pt of promptTokens) {
        if (pt.includes(ft) || ft.includes(pt)) {
            score += 0.4; // partial word
            break;
        }
    }
  }
  return score / featureTokens.length;
}

export function mapPromptToFeatures(prompt, featuresInDb, relationshipsInDb) {
  const result = {
      decision: "none",
      features: [],
      warnings: [],
      suggestions: []
  };

  if (!prompt || typeof prompt !== "string") return result;

  const promptTokens = normalize(prompt);
  if (promptTokens.length === 0) return result;

  const scoredFeatures = [];
  
  for (const feature of featuresInDb) {
      const featureTokens = normalize(feature.normalizedName);
      let matchScore = scoreMatch(promptTokens, featureTokens);
      
      if (matchScore > 0) {
          // Apply Priority Boost
          const boost = BOOSTS[feature.normalizedName] || feature.importanceScore || 0.5;
          const finalScore = matchScore * boost;

          scoredFeatures.push({
              feature,
              score: finalScore
          });
      }
  }

  scoredFeatures.sort((a, b) => b.score - a.score);

  if (scoredFeatures.length === 0) {
      result.decision = "none";
      result.warnings.push("No matching features found. Please specify a valid domain feature.");
      result.suggestions = featuresInDb.slice(0, 5).map(f => f.normalizedName);
      return result;
  }

  const topScore = scoredFeatures[0].score;
  result.decision = topScore >= 0.8 ? "strong" : "partial";
  
  if (result.decision === "partial") {
      result.warnings.push("Partial match detected. Falling back to related features.");
  }

  // Compile matched features
  for (const sf of scoredFeatures) {
      if (sf.score < 0.3) continue; // Noise filter
      
      const relatedFeatures = relationshipsInDb
        .filter(r => r.source === sf.feature.normalizedName)
        .map(r => ({ name: r.target, type: r.type }));

      result.features.push({
          name: sf.feature.normalizedName,
          files: sf.feature.files,
          relatedFeatures: relatedFeatures,
          coverage: 0, 
          confidence: sf.score,
          missingTestAreas: []
      });
  }

  return result;
}

export function generateDebugLog(projectId, extractedFeatures, mappingResult) {
  return {
      event: "feature_pipeline",
      projectId,
      extractedFeatureCount: extractedFeatures.length,
      mappedFeatures: mappingResult.features.map(f => f.name),
      score: mappingResult.features.length > 0 ? mappingResult.features[0].confidence : 0,
      decision: mappingResult.decision,
      coverageSummary: {},
      warnings: mappingResult.warnings
  };
}
