import type { Timestamp } from 'firebase/firestore';
import type { SmeltLog } from '../types';
import { schemaFieldError, schemaPayloadError } from './firestoreErrors';
import { isObject, isNonEmptyString, isFiniteNumber, isBoolean } from './typeGuards';

const COLLECTION = 'incident_logs';

function isTimestamp(value: unknown): value is Timestamp {
  return isObject(value)
    && typeof value.toDate === 'function'
    && typeof value.toMillis === 'function';
}

function expectString(data: Record<string, unknown>, key: string, docId: string): string {
  const value = data[key];
  if (!isNonEmptyString(value)) {
    throw schemaFieldError(COLLECTION, docId, key, 'non-empty string');
  }
  return value;
}

function expectNumber(data: Record<string, unknown>, key: string, docId: string): number {
  const value = data[key];
  if (!isFiniteNumber(value)) {
    throw schemaFieldError(COLLECTION, docId, key, 'finite number');
  }
  return value;
}

function expectBoolean(data: Record<string, unknown>, key: string, docId: string): boolean {
  const value = data[key];
  if (!isBoolean(value)) {
    throw schemaFieldError(COLLECTION, docId, key, 'boolean');
  }
  return value;
}

function expectNullableString(data: Record<string, unknown>, key: string, docId: string): string | null {
  const value = data[key];
  if (value === null) return null;
  if (typeof value === 'string') return value;
  throw schemaFieldError(COLLECTION, docId, key, 'string|null');
}

function expectTimestamp(data: Record<string, unknown>, key: string, docId: string): Timestamp {
  const value = data[key];
  if (!isTimestamp(value)) {
    throw schemaFieldError(COLLECTION, docId, key, 'Timestamp');
  }
  return value;
}

/**
 * Strict parser for incident_logs documents.
 * Every field is required. No fallbacks. No legacy handling.
 * The server writes all fields on create via the admin SDK.
 */
export function parseSmeltLog(docId: string, raw: unknown): SmeltLog {
  if (!isObject(raw)) {
    throw schemaPayloadError(COLLECTION, docId, 'object');
  }

  return {
    id: docId,
    impact_score: expectNumber(raw, 'impact_score', docId),
    pixel_count: expectNumber(raw, 'pixel_count', docId),
    incident_feed_summary: expectString(raw, 'incident_feed_summary', docId),
    color_1: expectString(raw, 'color_1', docId),
    color_2: expectString(raw, 'color_2', docId),
    color_3: expectString(raw, 'color_3', docId),
    color_4: expectString(raw, 'color_4', docId),
    color_5: expectString(raw, 'color_5', docId),
    subject_box_ymin: expectNumber(raw, 'subject_box_ymin', docId),
    subject_box_xmin: expectNumber(raw, 'subject_box_xmin', docId),
    subject_box_ymax: expectNumber(raw, 'subject_box_ymax', docId),
    subject_box_xmax: expectNumber(raw, 'subject_box_xmax', docId),
    legacy_infra_class: expectString(raw, 'legacy_infra_class', docId),
    diagnosis: expectString(raw, 'diagnosis', docId),
    chromatic_profile: expectString(raw, 'chromatic_profile', docId),
    system_dx: expectString(raw, 'system_dx', docId),
    severity: expectString(raw, 'severity', docId),
    primary_contamination: expectString(raw, 'primary_contamination', docId),
    contributing_factor: expectString(raw, 'contributing_factor', docId),
    failure_origin: expectString(raw, 'failure_origin', docId),
    disposition: expectString(raw, 'disposition', docId),
    archive_note: expectString(raw, 'archive_note', docId),
    og_headline: expectString(raw, 'og_headline', docId),
    share_quote: expectString(raw, 'share_quote', docId),
    anon_handle: expectString(raw, 'anon_handle', docId),
    timestamp: expectTimestamp(raw, 'timestamp', docId),
    uid: expectString(raw, 'uid', docId),
    breach_count: expectNumber(raw, 'breach_count', docId),
    escalation_count: expectNumber(raw, 'escalation_count', docId),
    sanction_count: expectNumber(raw, 'sanction_count', docId),
    sanctioned: expectBoolean(raw, 'sanctioned', docId),
    sanction_rationale: expectNullableString(raw, 'sanction_rationale', docId),
  };
}

interface SmeltLogDocLike {
  id: string;
  data(): unknown;
}

export interface ParseSmeltLogBatchResult {
  readonly entries: SmeltLog[];
  readonly invalidCount: number;
}

interface ParseSmeltLogBatchOptions {
  readonly source: string;
  readonly maxLoggedErrors?: number;
}

/**
 * Strictly parses a batch of incident logs while keeping stream consumers
 * resilient: malformed docs are counted and omitted, but never crash the
 * whole snapshot handler.
 */
export function parseSmeltLogBatch(
  docs: readonly SmeltLogDocLike[],
  { source, maxLoggedErrors = 3 }: ParseSmeltLogBatchOptions,
): ParseSmeltLogBatchResult {
  const entries: SmeltLog[] = [];
  let invalidCount = 0;

  for (const d of docs) {
    try {
      entries.push(parseSmeltLog(d.id, d.data()));
    } catch (error) {
      invalidCount += 1;
      if (invalidCount <= maxLoggedErrors) {
        console.error(`[${source}] Skipping malformed incident_logs/${d.id}:`, error);
      }
    }
  }

  if (invalidCount > maxLoggedErrors) {
    console.error(
      `[${source}] Skipped ${invalidCount - maxLoggedErrors} additional malformed incident(s).`
    );
  }

  return { entries, invalidCount };
}
