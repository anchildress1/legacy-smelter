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
