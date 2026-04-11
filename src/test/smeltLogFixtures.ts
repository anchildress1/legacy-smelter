import type { Timestamp } from 'firebase/firestore';
import type { SmeltLog } from '../types';

export function makeFixtureTimestamp(
  iso = '2026-04-10T12:00:00Z',
): Timestamp {
  const date = new Date(iso);
  return {
    toDate: () => date,
    toMillis: () => date.getTime(),
    seconds: Math.floor(date.getTime() / 1000),
    nanoseconds: 0,
    isEqual: () => false,
    toJSON: () => ({ seconds: 0, nanoseconds: 0 }),
    valueOf: () => String(date.getTime()),
  } as unknown as Timestamp;
}

export function makeFixtureLog(
  id: string,
  overrides: Partial<SmeltLog> = {},
): SmeltLog {
  return {
    id,
    impact_score: 0,
    pixel_count: 100,
    incident_feed_summary: 'summary',
    color_1: '#ff0000',
    color_2: '#00ff00',
    color_3: '#0000ff',
    color_4: '#ffff00',
    color_5: '#00ffff',
    subject_box_ymin: 0,
    subject_box_xmin: 0,
    subject_box_ymax: 1000,
    subject_box_xmax: 1000,
    legacy_infra_class: `Node ${id}`,
    diagnosis: 'd',
    chromatic_profile: 'p',
    severity: 'Severe',
    primary_contamination: 'c',
    contributing_factor: 'c',
    failure_origin: 'o',
    disposition: 'd',
    archive_note: 'n',
    og_headline: 'h',
    share_quote: 'q',
    anon_handle: 'a',
    timestamp: makeFixtureTimestamp(),
    uid: 'u',
    breach_count: 0,
    escalation_count: 0,
    sanction_count: 0,
    sanctioned: false,
    sanction_rationale: null,
    ...overrides,
  };
}
