/**
 * Shared utility functions used across multiple layers.
 * Zero dependencies on Express, Mongoose, or AI services.
 */

/**
 * Deduplicate and filter empty strings from a string array.
 * @param {unknown[]} arr
 * @returns {string[]}
 */
export function unique(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map(String).filter(Boolean))];
}

/**
 * Union two arrays with deduplication.
 * @param {unknown[]} a
 * @param {unknown[]} b
 * @returns {string[]}
 */
export function unionArrays(a, b) {
  return unique([...(a ?? []), ...(b ?? [])]);
}

/**
 * Safely convert any value to a trimmed string, returning a fallback on failure.
 * @param {unknown} value
 * @param {string} [fallback=""]
 * @returns {string}
 */
export function toStr(value, fallback = "") {
  if (value == null) return fallback;
  const s = String(value).trim();
  return s === "" ? fallback : s;
}
