/**
 * Context-Aware Guardrail System
 * Validates user prompt against project context to prevent AI hallucinations.
 */

const STOP_WORDS = new Set(["the", "to", "a", "of", "and", "in", "on", "for", "with", "is", "at", "by", "from", "an", "this", "that", "it"]);

const SYNONYMS = {
  "add": ["create", "insert"],
  "cart": ["basket"],
  "order": ["checkout", "purchase"]
};

/**
 * Normalizes text by converting to lowercase, splitting camelCase,
 * removing special characters and stop words.
 * @param {string} text
 * @returns {string[]} array of keywords
 */
export function normalize(text) {
  if (!text || typeof text !== "string") return [];
  
  // Split camelCase
  let normalized = text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  
  // Remove special characters
  normalized = normalized.replace(/[^a-z0-9\s]/g, ' ');
  
  // Split into words
  const words = normalized.split(/\s+/).filter(Boolean);
  
  // Remove stopwords and apply basic stemming
  return words
    .filter(word => !STOP_WORDS.has(word))
    .map(word => {
      // Basic stemming to handle cases like "adding" -> "add"
      if (word.length <= 3) return word;
      if (word.endsWith('ing')) {
        // e.g. "adding" -> "add"
        let stem = word.slice(0, -3);
        if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
          stem = stem.slice(0, -1); // "add"
        }
        return stem;
      }
      if (word.endsWith('ed')) {
        let stem = word.slice(0, -2);
        if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
          stem = stem.slice(0, -1);
        }
        return stem;
      }
      if (word.endsWith('es') && !word.endsWith('ss')) return word.slice(0, -2);
      if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
      return word;
    });
}

/**
 * Validates whether a user prompt matches the actual project context
 * @param {string} prompt 
 * @param {object} context 
 * @returns {object} { matchType: "none" | "partial" | "strong", score: number, matchedKeywords: string[], promptKeywords: string[], contextKeywords: string[], suggestions: string[] }
 */
export function matchPromptToContext(prompt, context) {
  if (!prompt || typeof prompt !== "string") {
    return { matchType: "strong", score: 1, matchedKeywords: [], promptKeywords: [], contextKeywords: [], suggestions: [] };
  }

  const basePromptKeywords = normalize(prompt);
  
  if (basePromptKeywords.length === 0) {
    return { matchType: "strong", score: 1, matchedKeywords: [], promptKeywords: [], contextKeywords: [], suggestions: [] };
  }

  // Expand prompt keywords with synonyms
  const promptKeywords = new Set(basePromptKeywords);
  for (const word of basePromptKeywords) {
    for (const [key, syns] of Object.entries(SYNONYMS)) {
      if (word === key) {
        syns.forEach(s => promptKeywords.add(s));
      } else if (syns.includes(word)) {
        promptKeywords.add(key);
        syns.forEach(s => promptKeywords.add(s));
      }
    }
  }

  const contextKeywordsSet = new Set();
  
  // Helper to extract and normalize
  const extractAndNormalize = (list) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const name = typeof item === "string" ? item : (item.name || "");
      if (name) {
        const words = normalize(name);
        words.forEach(w => contextKeywordsSet.add(w));
      }
    }
  };

  extractAndNormalize(context.modules);
  extractAndNormalize(context.routes);
  if (context.codeInsights) {
    extractAndNormalize(context.codeInsights.functions);
    extractAndNormalize(context.codeInsights.variables);
    extractAndNormalize(context.codeInsights.classes);
  }
  extractAndNormalize(context.priorityFiles);

  const contextKeywords = Array.from(contextKeywordsSet);
  
  // Determine matches against the expanded prompt keywords
  const matchedExpandedKeywords = Array.from(promptKeywords).filter(k => contextKeywordsSet.has(k));
  
  // We calculate score based on how many of the base prompt keywords were matched (either directly or via synonym)
  let matchedBaseCount = 0;
  const matchedKeywords = [];
  
  for (const word of basePromptKeywords) {
    let isMatched = false;
    
    // Check if word itself is in context
    if (contextKeywordsSet.has(word)) {
      isMatched = true;
      matchedKeywords.push(word);
    } else {
      // Check if any of its synonyms are in context
      let hasSynonymMatch = false;
      for (const [key, syns] of Object.entries(SYNONYMS)) {
        if (word === key) {
          hasSynonymMatch = syns.some(s => contextKeywordsSet.has(s));
        } else if (syns.includes(word)) {
          hasSynonymMatch = contextKeywordsSet.has(key) || syns.some(s => contextKeywordsSet.has(s));
        }
      }
      if (hasSynonymMatch) {
        isMatched = true;
        matchedKeywords.push(word);
      }
    }
    
    if (isMatched) {
      matchedBaseCount++;
    }
  }

  // Deduplicate matchedKeywords
  const uniqueMatchedKeywords = Array.from(new Set(matchedKeywords));

  const score = matchedBaseCount / basePromptKeywords.length;
  const finalScore = Math.min(score, 1);

  let matchType = "none";
  if (finalScore >= 0.6) {
    matchType = "strong";
  } else if (finalScore >= 0.3) {
    matchType = "partial";
  }
  
  // Suggestions: pick up to 5 closest matches or just some top context keywords
  const suggestions = contextKeywords.slice(0, 5);

  return {
    matchType,
    score: finalScore,
    matchedKeywords: uniqueMatchedKeywords,
    promptKeywords: basePromptKeywords,
    contextKeywords,
    suggestions
  };
}

/**
 * Detect missing features from prompt
 */
export function detectMissingFeatures(promptKeywords, features) {
  const missing = [];
  const featureSet = new Set(features.map(f => f.toLowerCase()));
  const IGNORE_TERMS_SET = new Set([
    "create", "creation", "add", "adding",
    "update", "delete", "flow", "process"
  ]);
  
  for (const keyword of promptKeywords) {
    if (!featureSet.has(keyword) && !IGNORE_TERMS_SET.has(keyword)) {
      let hasSynonym = false;
      for (const [key, syns] of Object.entries(SYNONYMS)) {
        if (keyword === key && syns.some(s => featureSet.has(s))) hasSynonym = true;
        if (syns.includes(keyword) && (featureSet.has(key) || syns.some(s => featureSet.has(s)))) hasSynonym = true;
      }
      if (!hasSynonym) {
        missing.push(keyword);
      }
    }
  }
  return missing;
}

/**
 * Validates the AI response to ensure it only includes known features
 * @param {object[]} testCases 
 * @param {string[]} allowedFeatures 
 * @returns {object} { isValid: boolean, decision: string, detectedTerms: string[], invalidTerms: string[] }
 */
export function validateAIOutput(testCases, allowedFeatures) {
  if (!Array.isArray(allowedFeatures) || allowedFeatures.length === 0) {
    return { isValid: true, decision: "accepted", detectedTerms: [], invalidTerms: [] };
  }

  const allowedSet = new Set(allowedFeatures.map(f => f.toLowerCase()));
  const unknownFeatures = new Set();
  const detectedTerms = new Set();
  
  const IGNORE_TERMS = new Set([
    "create", "creation", "add", "adding",
    "update", "delete", "flow", "process"
  ]);

  for (const tc of testCases) {
    const tags = Array.isArray(tc.tags) ? tc.tags : [];
    for (const tag of tags) {
      if (tag && typeof tag === "string") {
        const tagLower = tag.toLowerCase().trim();
        detectedTerms.add(tagLower);
        
        const isGeneric = ["auth", "api", "ui", "edge-case", "happy-path", "error-handling", "backend", "frontend", "database"].includes(tagLower);
        
        if (!isGeneric && !IGNORE_TERMS.has(tagLower)) {
          let isKnown = false;
          for (const allowed of allowedSet) {
             if (tagLower.includes(allowed) || allowed.includes(tagLower)) {
                isKnown = true;
                break;
             }
          }
          
          if (!isKnown) {
             let hasSynonym = false;
             for (const [key, syns] of Object.entries(SYNONYMS)) {
               if (tagLower === key && syns.some(s => allowedSet.has(s))) hasSynonym = true;
               if (syns.includes(tagLower) && (allowedSet.has(key) || syns.some(s => allowedSet.has(s)))) hasSynonym = true;
             }
             if (!hasSynonym) {
               unknownFeatures.add(tag);
             }
          }
        }
      }
    }
  }

  const invalidTerms = Array.from(unknownFeatures);
  const decision = invalidTerms.length > 0 ? "warning" : "accepted";

  return {
    isValid: true, // Soft validation -> don't hard reject
    decision,
    detectedTerms: Array.from(detectedTerms),
    invalidTerms
  };
}
