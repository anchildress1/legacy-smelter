import type { Timestamp } from 'firebase/firestore';
import type { SmeltLog } from '../types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTimestamp(value: unknown): value is Timestamp {
  return isObject(value)
    && typeof value.toDate === 'function'
    && typeof value.toMillis === 'function';
}

function expectString(data: Record<string, unknown>, key: string, docId: string): string {
  const value = data[key];
  if (typeof value !== 'string' || !value) {
    throw new Error(`incident_logs/${docId} has invalid "${key}" (expected non-empty string)`);
  }
  return value;
}

function expectNumber(data: Record<string, unknown>, key: string, docId: string): number {
  const value = data[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`incident_logs/${docId} has invalid "${key}" (expected finite number)`);
  }
  return value;
}

function expectBoolean(data: Record<string, unknown>, key: string, docId: string): boolean {
  const value = data[key];
  if (typeof value !== 'boolean') {
    throw new Error(`incident_logs/${docId} has invalid "${key}" (expected boolean)`);
  }
  return value;
}

function expectNullableString(data: Record<string, unknown>, key: string, docId: string): string | null {
  const value = data[key];
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  throw new Error(`incident_logs/${docId} has invalid "${key}" (expected string|null)`);
}

function expectTimestampOrNull(data: Record<string, unknown>, key: string, docId: string): Timestamp | null {
  const value = data[key];
  if (value === null || value === undefined) return null;
  if (isTimestamp(value)) return value;
  throw new Error(`incident_logs/${docId} has invalid "${key}" (expected Timestamp|null)`);
}

// Voting/sanction fields are optional — absent on newly created incidents,
// populated by the sanction script and escalation/breach services.
function optionalNumber(data: Record<string, unknown>, key: string, fallback: number): number {
  const value = data[key];
  if (value === undefined) return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

function optionalBoolean(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = data[key];
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return fallback;
}

/**
 * Strict parser for incident_logs documents.
 * Core incident fields are required and validated.
 * Voting/sanction fields are optional with sensible defaults for unjudged incidents.
 */
export function parseSmeltLog(docId: string, raw: unknown): SmeltLog {
  if (!isObject(raw)) {
    throw new Error(`incident_logs/${docId} has invalid payload (expected object)`);
  }

  return {
    id: docId,
    // Core incident fields — required
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
    timestamp: expectTimestampOrNull(raw, 'timestamp', docId),
    uid: expectString(raw, 'uid', docId),
    // Voting/sanction fields — optional, default to unjudged state
    breach_count: optionalNumber(raw, 'breach_count', 0),
    escalation_count: optionalNumber(raw, 'escalation_count', 0),
    sanction_count: optionalNumber(raw, 'sanction_count', 0),
    judged: optionalBoolean(raw, 'judged', false),
    sanctioned: optionalBoolean(raw, 'sanctioned', false),
    sanction_rationale: expectNullableString(raw, 'sanction_rationale', docId),
  };
}
