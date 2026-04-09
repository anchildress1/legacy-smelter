import type { Severity } from "../types";

export interface SmeltAnalysis {
  legacyInfraClass: string;
  diagnosis: string;
  dominantColors: string[];
  chromaticProfile: string;
  systemDx: string;
  severity: Severity;
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
}

function expectString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || !value) {
    throw new Error(`API response missing or empty "${key}"`);
  }
  return value;
}

function parseSmeltAnalysis(raw: unknown, pixelCount: number): SmeltAnalysis {
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

  const pixelCountVal = typeof obj.pixelCount === 'number' ? obj.pixelCount : pixelCount;

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
    pixelCount: pixelCountVal,
    subjectBox: subjectBox as [number, number, number, number],
  };
}

export async function analyzeLegacyTech(base64Image: string, mimeType: string): Promise<SmeltAnalysis> {
  // Pixel count is calculated client-side (requires browser Image API)
  let pixelCount = 2073600; // fallback: 1920×1080 (full-HD)
  if (typeof window !== "undefined") {
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = `data:${mimeType};base64,${base64Image}`;
      });
      pixelCount = img.width * img.height;
    } catch (err) {
      console.warn("Failed to calculate pixel count", err);
    }
  }

  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Image, mimeType }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Analysis failed' }));
    throw new Error(body.error || `Server returned ${response.status}`);
  }

  const result = await response.json();
  return parseSmeltAnalysis(result, pixelCount);
}
