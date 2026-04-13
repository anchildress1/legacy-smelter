import { describe, expect, it } from 'vitest';
import {
  isBoolean,
  isFiniteNumber,
  isNonEmptyString,
  isNumberTuple4,
  isObject,
} from './typeGuards';

/**
 * Context-free primitive guards shared by `parseSmeltLog` (Firestore
 * doc parser) and `parseSmeltAnalysis` (HTTP response parser). Both
 * parsers rely on these guards' discriminator behaviour, so a silent
 * drift here would cascade into every runtime boundary at once.
 */

describe('isObject', () => {
  it('accepts plain objects and class instances', () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
    expect(isObject(new Map())).toBe(true);
  });

  it('accepts arrays (arrays are typeof "object")', () => {
    // Callers that need to reject arrays specifically must layer
    // `Array.isArray` on top — pinning the guard's current semantics.
    expect(isObject([])).toBe(true);
  });

  it('rejects null, undefined, primitives, and functions', () => {
    expect(isObject(null)).toBe(false);
    expect(isObject(undefined)).toBe(false);
    expect(isObject('x')).toBe(false);
    expect(isObject(0)).toBe(false);
    expect(isObject(true)).toBe(false);
    expect(isObject(() => 1)).toBe(false);
  });
});

describe('isNonEmptyString', () => {
  it('accepts any string with length >= 1', () => {
    expect(isNonEmptyString('a')).toBe(true);
    expect(isNonEmptyString(' ')).toBe(true); // whitespace counts — callers trim
    expect(isNonEmptyString('hello')).toBe(true);
  });

  it('rejects empty strings', () => {
    expect(isNonEmptyString('')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(0)).toBe(false);
    expect(isNonEmptyString(false)).toBe(false);
    // Boxed strings are objects, not primitives — they fail the
    // primitive `typeof` check, which is the intended behaviour.
    expect(isNonEmptyString(Object('hi'))).toBe(false);
  });
});

describe('isFiniteNumber', () => {
  it('accepts finite numbers including zero and negatives', () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-1)).toBe(true);
    expect(isFiniteNumber(3.14)).toBe(true);
    expect(isFiniteNumber(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('rejects NaN and both infinities', () => {
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteNumber(Number.NEGATIVE_INFINITY)).toBe(false);
  });

  it('rejects numeric strings and bigints', () => {
    expect(isFiniteNumber('1')).toBe(false);
    expect(isFiniteNumber(1n)).toBe(false);
  });
});

describe('isBoolean', () => {
  it('accepts true and false', () => {
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean(false)).toBe(true);
  });

  it('rejects truthy/falsy values that are not booleans', () => {
    expect(isBoolean(0)).toBe(false);
    expect(isBoolean(1)).toBe(false);
    expect(isBoolean('true')).toBe(false);
    expect(isBoolean(null)).toBe(false);
    expect(isBoolean(undefined)).toBe(false);
  });
});

describe('isNumberTuple4', () => {
  it('accepts exactly four-element numeric arrays', () => {
    expect(isNumberTuple4([0, 0, 0, 0])).toBe(true);
    expect(isNumberTuple4([1, 2, 3, 4])).toBe(true);
    expect(isNumberTuple4([-1, 0.5, 1e6, -Infinity])).toBe(true);
  });

  it('rejects arrays of the wrong length', () => {
    expect(isNumberTuple4([])).toBe(false);
    expect(isNumberTuple4([1])).toBe(false);
    expect(isNumberTuple4([1, 2, 3])).toBe(false);
    expect(isNumberTuple4([1, 2, 3, 4, 5])).toBe(false);
  });

  it('rejects arrays containing a non-number', () => {
    expect(isNumberTuple4([1, 2, 3, '4'])).toBe(false);
    expect(isNumberTuple4([1, 2, null, 4])).toBe(false);
    expect(isNumberTuple4([1, 2, 3, undefined])).toBe(false);
  });

  it('rejects non-array values', () => {
    expect(isNumberTuple4(null)).toBe(false);
    expect(isNumberTuple4('1,2,3,4')).toBe(false);
    expect(isNumberTuple4({ length: 4 })).toBe(false);
  });
});
