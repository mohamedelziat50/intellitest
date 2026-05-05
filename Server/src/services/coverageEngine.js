export function calculateCoverage(featureName, testCases) {
  const templates = {
    "cart": ["add item", "remove item", "update quantity", "empty cart", "persist cart"],
    "checkout": ["place order", "payment success", "payment failure", "validation", "confirmation"],
    "auth": ["login", "register", "password reset", "invalid credentials"],
    "product": ["view details", "add to cart", "out of stock", "variant selection"]
  };

  const nameLower = featureName.toLowerCase();
  
  let expectedAreas = [];
  for (const [key, scenarios] of Object.entries(templates)) {
      if (nameLower.includes(key)) {
          expectedAreas = scenarios;
          break;
      }
  }

  // Fallback to dynamic basic areas if unknown
  if (expectedAreas.length === 0) {
      expectedAreas = ["happy path", "edge cases", "error handling", "data validation"];
  }

  if (!Array.isArray(testCases) || testCases.length === 0) {
    return {
      coverage: 0,
      confidence: 0,
      missingAreas: expectedAreas,
      coveredAreas: []
    };
  }

  const coveredAreas = new Set();
  
  for (const tc of testCases) {
      const desc = tc.description ? tc.description.toLowerCase() : "";
      const name = tc.name ? tc.name.toLowerCase() : "";
      const combined = `${name} ${desc}`;
      
      for (const area of expectedAreas) {
          if (combined.includes(area)) {
              coveredAreas.add(area);
              continue;
          }
          
          // Fallbacks for specific semantic meanings
          if (area === "payment failure" && (combined.includes("fail") || combined.includes("decline") || combined.includes("error"))) coveredAreas.add(area);
          if (area === "validation" && (combined.includes("invalid") || combined.includes("required") || combined.includes("missing"))) coveredAreas.add(area);
          if (area === "edge cases" && (combined.includes("empty") || combined.includes("limit") || combined.includes("max") || combined.includes("min"))) coveredAreas.add(area);
          if (area === "error handling" && (combined.includes("error") || combined.includes("exception") || combined.includes("500"))) coveredAreas.add(area);
          if (area === "happy path" && (combined.includes("success") || combined.includes("valid") || combined.includes("correct"))) coveredAreas.add(area);
      }
  }

  const missingAreas = expectedAreas.filter(a => !coveredAreas.has(a));
  const coverage = expectedAreas.length > 0 ? (coveredAreas.size / expectedAreas.length) * 100 : 0;
  
  // Confidence is based on how many expected areas are covered and the total number of test cases.
  // 1.0 confidence if 100% coverage and at least 1 test case per area.
  let confidence = coverage / 100.0;
  if (testCases.length < expectedAreas.length) {
      confidence *= (testCases.length / expectedAreas.length); // Penalty for too few tests
  }

  return {
    coverage: Math.round(coverage),
    confidence: parseFloat(confidence.toFixed(2)),
    missingAreas,
    coveredAreas: Array.from(coveredAreas)
  };
}
