export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error (non-serializable value)';
  }
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  onError?: (message: string) => void
) {
  const errInfo: FirestoreErrorInfo = {
    error: stringifyError(error),
    operationType,
    path
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  onError?.(`FIRESTORE ${operationType.toUpperCase()} FAILED. DATA MAY BE STALE.`);
}

/**
 * Builds a consistent "<collection>/<docId> has invalid <field> (expected ...)"
 * error for schema validation failures. Centralized here so parseSmeltLog and
 * any future per-collection parsers share the same wording, and so anything
 * that pattern-matches on these messages only needs to look in one place.
 */
export function schemaFieldError(
  collection: string,
  docId: string,
  field: string,
  expected: string,
): Error {
  return new Error(`${collection}/${docId} has invalid "${field}" (expected ${expected})`);
}

export function schemaPayloadError(
  collection: string,
  docId: string,
  expected: string,
): Error {
  return new Error(`${collection}/${docId} has invalid payload (expected ${expected})`);
}
