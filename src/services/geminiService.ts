import { ensureAnonymousAuth } from "../firebase";
import { getAuth } from "firebase/auth";
import { isObject, isNonEmptyString, isFiniteNumber, isNumberTuple4 } from "../lib/typeGuards";

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
    throw new Error('API response missing dominantColors array');
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
    throw new Error(errorMsg);
  }

  return parseSmeltAnalysis(await response.json());
}
