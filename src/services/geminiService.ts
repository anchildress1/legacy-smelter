import { ensureAnonymousAuth } from "../firebase";
import { getAuth } from "firebase/auth";
import { isObject, isNonEmptyString, isFiniteNumber, isNumberTuple4 } from "../lib/typeGuards";

/**
 * Category of an analysis failure, inferred from the HTTP status code
 * and used by the UI to decide which recovery message to show. The
 * categories are disjoint — each `AnalysisError` has exactly one — and
 * map to user-visible copy in `App.tsx` instead of surfacing raw server
 * error strings (which can include internal error IDs and are not
 * phrased for end users).
 */
export type AnalysisErrorCategory =
  | 'auth'
  | 'rate_limited'
  | 'server_busy'
  | 'payload'
  | 'analysis'
  | 'unknown';

/**
 * Custom error class for failures returned by `POST /api/analyze`. The
 * UI catches this specifically so it can render a category-appropriate
 * recovery message (e.g. "try again shortly" for 429 vs "image too
 * large" for 413) instead of silently bouncing the user back to idle
 * after a `console.error`. Non-HTTP failures (network disconnect,
 * DNS) do NOT throw this class — they throw a plain `Error` and the
 * caller should treat them as `category: 'unknown'`.
 */
export class AnalysisError extends Error {
  readonly status: number;
  readonly category: AnalysisErrorCategory;

  constructor(status: number, message: string, category: AnalysisErrorCategory) {
    super(message);
    this.name = 'AnalysisError';
    this.status = status;
    this.category = category;
  }
}

function categoryForStatus(status: number): AnalysisErrorCategory {
  if (status === 401) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'server_busy';
  if (status === 400 || status === 413 || status === 415) return 'payload';
  if (status === 502) return 'analysis';
  return 'unknown';
}

export interface SmeltAnalysis {
  legacyInfraClass: string;
  diagnosis: string;
  dominantColors: string[];
  chromaticProfile: string;
  systemDx: string;
  severity: string;
  primaryContamination: string;
  contributingFactor: string;
  failureOrigin: string;
  disposition: string;
  incidentFeedSummary: string;
  archiveNote: string;
  ogHeadline: string;
  shareQuote: string;
  anonHandle: string;
  pixelCount: number;
  subjectBox: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000
  incidentId: string; // Firestore doc ID, assigned server-side on write
}

function expectString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (!isNonEmptyString(value)) {
    throw new Error(`API response missing or empty "${key}"`);
  }
  return value;
}

function parseSmeltAnalysis(raw: unknown): SmeltAnalysis {
  if (!isObject(raw)) {
    throw new Error('API response is not an object');
  }

  const dominantColors = raw.dominantColors;
  if (!Array.isArray(dominantColors)) {
    throw new TypeError('API response missing dominantColors array');
  }

  const subjectBox = raw.subjectBox;
  if (!isNumberTuple4(subjectBox)) {
    throw new Error('API response has invalid subjectBox (expected 4-number array)');
  }

  const pixelCount = raw.pixelCount;
  if (!isFiniteNumber(pixelCount) || pixelCount <= 0) {
    throw new Error('API response missing or invalid pixelCount');
  }

  return {
    legacyInfraClass: expectString(raw, 'legacyInfraClass'),
    diagnosis: expectString(raw, 'diagnosis'),
    dominantColors: dominantColors.filter((c): c is string => typeof c === 'string'),
    chromaticProfile: expectString(raw, 'chromaticProfile'),
    systemDx: expectString(raw, 'systemDx'),
    severity: expectString(raw, 'severity'),
    primaryContamination: expectString(raw, 'primaryContamination'),
    contributingFactor: expectString(raw, 'contributingFactor'),
    failureOrigin: expectString(raw, 'failureOrigin'),
    disposition: expectString(raw, 'disposition'),
    incidentFeedSummary: expectString(raw, 'incidentFeedSummary'),
    archiveNote: expectString(raw, 'archiveNote'),
    ogHeadline: expectString(raw, 'ogHeadline'),
    shareQuote: expectString(raw, 'shareQuote'),
    anonHandle: expectString(raw, 'anonHandle'),
    pixelCount,
    subjectBox,
    incidentId: expectString(raw, 'incidentId'),
  };
}

export async function analyzeLegacyTech(base64Image: string, mimeType: string): Promise<SmeltAnalysis> {
  await ensureAnonymousAuth();
  const user = getAuth().currentUser;
  if (!user) {
    throw new Error('Authentication required to analyze image.');
  }
  const idToken = await user.getIdToken();

  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({ image: base64Image, mimeType }),
  });

  if (!response.ok) {
    let errorMsg = `Server returned ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body?.error === 'string' && body.error) errorMsg = body.error;
    } catch {
      // Response body wasn't JSON — keep the status-based message.
    }
    throw new AnalysisError(response.status, errorMsg, categoryForStatus(response.status));
  }

  return parseSmeltAnalysis(await response.json());
}
