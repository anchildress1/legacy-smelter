// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FALLBACK_COLORS, getFiveDistinctColors } from './colors.js';

/**
 * `getFiveDistinctColors` is the render-side defensive gate between the
 * Gemini response schema (which only claims "string[]" for dominant hex
 * colors) and the card's chromatic fingerprint strip. Every downstream
 * renderer — cards, overlay, manifest — relies on the "exactly 5
 * distinct hex colors" contract, so tests here pin both the happy path
 * and every graceful-fallback branch.
 */

describe('FALLBACK_COLORS', () => {
  it('exports five distinct hex colors in the frozen fallback list', () => {
    expect(FALLBACK_COLORS).toHaveLength(5);
    expect(new Set(FALLBACK_COLORS).size).toBe(5);
    for (const color of FALLBACK_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('getFiveDistinctColors', () => {
  it('returns exactly five colors for a clean five-entry input', () => {
    const input = ['#111111', '#222222', '#333333', '#444444', '#555555'];
    expect(getFiveDistinctColors(input)).toEqual(input);
  });

  it('lowercases and trims each entry before comparing', () => {
    const result = getFiveDistinctColors(['  #ABCDEF  ', '#abcdef']);
    expect(result[0]).toBe('#abcdef');
    // After dedup, the remaining 4 slots are padded from FALLBACK_COLORS.
    expect(result).toHaveLength(5);
  });

  it('deduplicates entries differing only in casing', () => {
    const result = getFiveDistinctColors(['#AABBCC', '#aabbcc', '#AABBCC']);
    const uniqueFromInput = result.filter((c) => c === '#aabbcc');
    expect(uniqueFromInput).toHaveLength(1);
    expect(result).toHaveLength(5);
  });

  it('pads from FALLBACK_COLORS when fewer than five valid entries exist', () => {
    const input = ['#000001', '#000002'];
    const result = getFiveDistinctColors(input);
    expect(result).toHaveLength(5);
    expect(result.slice(0, 2)).toEqual(['#000001', '#000002']);
    // The remaining 3 slots come from the fallback list, in order.
    expect(result.slice(2)).toEqual(FALLBACK_COLORS.slice(0, 3));
  });

  it('returns the full fallback palette when every input entry is invalid', () => {
    const result = getFiveDistinctColors(['not-a-color', '##zzzzzz', 'rgb(1,2,3)']);
    expect(result).toEqual(FALLBACK_COLORS);
  });

  it('rejects non-array inputs without throwing', () => {
    // The comment at the top of the source notes this is defensive — if
    // Gemini leaks a non-array for dominantColors, the card must still
    // render. Each of these inputs skips validation entirely and falls
    // back to the canonical palette.
    expect(getFiveDistinctColors(null)).toEqual(FALLBACK_COLORS);
    expect(getFiveDistinctColors(undefined)).toEqual(FALLBACK_COLORS);
    expect(getFiveDistinctColors('not-an-array')).toEqual(FALLBACK_COLORS);
    expect(getFiveDistinctColors({ 0: '#ffffff' })).toEqual(FALLBACK_COLORS);
  });

  it('skips non-string entries and continues validating the rest', () => {
    const result = getFiveDistinctColors(['#ff0000', 42, null, { hex: '#00ff00' }, '#00ff00']);
    expect(result[0]).toBe('#ff0000');
    expect(result[1]).toBe('#00ff00');
    expect(result).toHaveLength(5);
  });

  it('rejects 3-digit short-hand hex (schema is strict 6-digit only)', () => {
    // `#fff` is a valid CSS shorthand but the schema only accepts the
    // 6-character form. Pinning this so a future loosening is deliberate.
    const result = getFiveDistinctColors(['#fff', '#f0f']);
    expect(result).toEqual(FALLBACK_COLORS);
  });

  it('rejects hex entries without the leading "#"', () => {
    const result = getFiveDistinctColors(['ff0000', '#ff0000']);
    expect(result[0]).toBe('#ff0000');
    // Only one valid color; four fallbacks fill the remaining slots.
    expect(result.slice(1)).toEqual(FALLBACK_COLORS.slice(0, 4));
  });

  it('caps output at five even when given many unique valid entries', () => {
    const input = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777'];
    expect(getFiveDistinctColors(input)).toEqual(input.slice(0, 5));
  });

  it('returns an empty-input result equal to the fallback palette', () => {
    expect(getFiveDistinctColors([])).toEqual(FALLBACK_COLORS);
  });
});
