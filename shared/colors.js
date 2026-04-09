export const FALLBACK_COLORS = ['#ffff00', '#00c3f5', '#4db542', '#fb0094', '#fc9103'];

/**
 * Returns exactly 5 distinct hex colors from the input array,
 * padding with FALLBACK_COLORS when fewer than 5 valid colors are provided.
 * @param {string[]} colors
 * @returns {string[]}
 */
export function getFiveDistinctColors(colors) {
  const hexRegex = /^#([0-9a-f]{6})$/i;
  const validColors = colors
    .map(c => c.toLowerCase().trim())
    .filter(c => hexRegex.test(c));

  const uniqueSrc = Array.from(new Set(validColors));
  const combined = Array.from(new Set([...uniqueSrc, ...FALLBACK_COLORS]));
  return combined.slice(0, 5);
}
