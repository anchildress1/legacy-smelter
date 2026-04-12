import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OperationType,
  buildFirestoreUserMessage,
  handleFirestoreError,
  schemaFieldError,
  schemaPayloadError,
} from './firestoreErrors';

/**
 * Firestore error plumbing. Every page that writes to Firestore relays
 * user-facing messages through `handleFirestoreError`; the message
 * format must stay stable because UI strings compare against it for
 * toast-style rendering.
 */

describe('buildFirestoreUserMessage', () => {
  it('formats the operation type uppercase inside a fixed message shell', () => {
    expect(buildFirestoreUserMessage(OperationType.CREATE)).toBe(
      'FIRESTORE CREATE FAILED. DATA MAY BE STALE.',
    );
    expect(buildFirestoreUserMessage(OperationType.DELETE)).toBe(
      'FIRESTORE DELETE FAILED. DATA MAY BE STALE.',
    );
    expect(buildFirestoreUserMessage(OperationType.WRITE)).toBe(
      'FIRESTORE WRITE FAILED. DATA MAY BE STALE.',
    );
  });
});

describe('schemaFieldError', () => {
  it('composes the canonical "<collection>/<docId> has invalid <field> (expected ...)" shape', () => {
    const err = schemaFieldError('incident_logs', 'doc-1', 'impact_score', 'finite number');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(
      'incident_logs/doc-1 has invalid "impact_score" (expected finite number)',
    );
  });

  it('escapes special characters in field and expected without transforming them', () => {
    const err = schemaFieldError('col', 'doc', 'a/b', 'string|null');
    expect(err.message).toBe('col/doc has invalid "a/b" (expected string|null)');
  });
});

describe('schemaPayloadError', () => {
  it('composes the canonical "<collection>/<docId> has invalid payload (expected ...)" shape', () => {
    const err = schemaPayloadError('incident_logs', 'doc-x', 'object');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('incident_logs/doc-x has invalid payload (expected object)');
  });
});

describe('handleFirestoreError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a JSON-encoded error record and invokes onError with the user message', () => {
    const onError = vi.fn();
    handleFirestoreError(
      new Error('boom'),
      OperationType.UPDATE,
      'incident_logs/inc-1',
      onError,
    );

    expect(console.error).toHaveBeenCalledOnce();
    const loggedPayload = (console.error as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][1];
    expect(JSON.parse(String(loggedPayload))).toEqual({
      error: 'boom',
      operationType: 'update',
      path: 'incident_logs/inc-1',
    });
    expect(onError).toHaveBeenCalledWith('FIRESTORE UPDATE FAILED. DATA MAY BE STALE.');
  });

  it('stringifies non-Error values (strings, objects) when logging', () => {
    const onError = vi.fn();
    handleFirestoreError('raw string', OperationType.GET, null, onError);

    const loggedPayload = (console.error as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][1];
    expect(JSON.parse(String(loggedPayload))).toEqual({
      error: 'raw string',
      operationType: 'get',
      path: null,
    });
    expect(onError).toHaveBeenCalledWith('FIRESTORE GET FAILED. DATA MAY BE STALE.');
  });

  it('falls back to a JSON-stringified rendering for arbitrary objects', () => {
    const onError = vi.fn();
    handleFirestoreError({ code: 42 }, OperationType.LIST, null, onError);
    const loggedPayload = (console.error as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][1];
    expect(JSON.parse(String(loggedPayload))).toEqual({
      error: '{"code":42}',
      operationType: 'list',
      path: null,
    });
  });

  it('handles non-serializable values without throwing', () => {
    // Circular references would normally make `JSON.stringify` throw; the
    // handler must still log something useful and invoke onError so the
    // UI does not freeze mid-toast.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const onError = vi.fn();

    expect(() =>
      handleFirestoreError(circular, OperationType.DELETE, null, onError),
    ).not.toThrow();
    expect(onError).toHaveBeenCalledWith('FIRESTORE DELETE FAILED. DATA MAY BE STALE.');
  });

  it('tolerates a missing onError callback (logs only)', () => {
    expect(() =>
      handleFirestoreError(new Error('boom'), OperationType.CREATE, null),
    ).not.toThrow();
    expect(console.error).toHaveBeenCalledOnce();
  });
});
