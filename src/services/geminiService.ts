import { ensureAnonymousAuth } from "../firebase";
import { getAuth } from "firebase/auth";

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
  if (typeof value !== 'string' || !value) {
    throw new Error(`API response missing or empty "${key}"`);
  }
  return value;
}

function parseSmeltAnalysis(raw: unknown): SmeltAnalysis {
  if (!raw || typeof raw !== 'object') {
    throw new Error('API response is not an object');
  }
  const obj = raw as Record<string, unknown>;

  const dominantColors = obj.dominantColors;
  if (!Array.isArray(dominantColors)) {
    throw new Error('API response missing dominantColors array');
  }

  const subjectBox = obj.subjectBox;
  if (!Array.isArray(subjectBox) || subjectBox.length !== 4 || !subjectBox.every(v => typeof v === 'number')) {
    throw new Error('API response has invalid subjectBox (expected 4-number array)');
  }

  const pixelCount = obj.pixelCount;
  if (typeof pixelCount !== 'number' || !Number.isFinite(pixelCount) || pixelCount <= 0) {
    throw new Error('API response missing or invalid pixelCount');
  }

  return {
    legacyInfraClass: expectString(obj, 'legacyInfraClass'),
    diagnosis: expectString(obj, 'diagnosis'),
    dominantColors: dominantColors.filter((c): c is string => typeof c === 'string'),
    chromaticProfile: expectString(obj, 'chromaticProfile'),
    systemDx: expectString(obj, 'systemDx'),
    severity: expectString(obj, 'severity'),
    primaryContamination: expectString(obj, 'primaryContamination'),
    contributingFactor: expectString(obj, 'contributingFactor'),
    failureOrigin: expectString(obj, 'failureOrigin'),
    disposition: expectString(obj, 'disposition'),
    incidentFeedSummary: expectString(obj, 'incidentFeedSummary'),
    archiveNote: expectString(obj, 'archiveNote'),
    ogHeadline: expectString(obj, 'ogHeadline'),
    shareQuote: expectString(obj, 'shareQuote'),
    anonHandle: expectString(obj, 'anonHandle'),
    pixelCount,
    subjectBox: subjectBox as [number, number, number, number],
    incidentId: expectString(obj, 'incidentId'),
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
