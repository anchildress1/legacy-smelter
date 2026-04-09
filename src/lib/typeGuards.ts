/**
 * Primitive type guards shared between parsers.
 *
 * These are intentionally context-free — they check the shape of a value
 * without formatting any error message. Each caller (parseSmeltLog for
 * Firestore docs, parseSmeltAnalysis for HTTP responses) wraps these
 * guards with its own error prefix so thrown messages stay attributable
 * to their source.
 */

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isNumberTuple4(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value)
    && value.length === 4
    && value.every((v) => typeof v === 'number');
}
