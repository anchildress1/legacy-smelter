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
  return { ...result, pixelCount };
}
