import { GoogleGenAI, Type } from "@google/genai";
import { getFiveDistinctColors } from "../lib/utils";
import type { Severity } from "../types";

function normalizeSeverity(value: unknown): Severity {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return 'Unclassified';
}

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

const GEMINI_PROMPT = `You are the incident analysis engine for Legacy Smelter. You analyze uploaded images and classify them as condemned technical artifacts requiring thermal decommission.

Return a single valid JSON object matching the schema.

## Voice

Enterprise incident report. Postmortem tone: dry, precise, operational, concise. Accusatory toward the artifact and its history.

The system treats absurd subjects as routine incidents. It is filing an incident report. It does not know it is funny.

Comedy mechanics:
- Specificity over generality. "Also, the green paint" is funny. Find the one weird concrete thing in the image and call it out.
- The deadpan afterthought. End a technical assessment with a flat, too-honest trailing observation.
- Commit past the point of reason. Start institutional, then escalate without changing tone.

## Sentence patterns

Short declarative clauses. Sentences under 12 words. Conclusions, not descriptions. Open with a classification or finding. Let the image content drive vocabulary.

## Field constraints

- legacy_infra_class: 5 words max. What the system thinks the image is. Specific to the actual content. "SELFIE SYSTEM V1.0" not "HUMANOID VISUAL NODE." "DESKTOP FAUNA INCIDENT" not "HUMAN-INTEGRATED WORKSPACE." If someone reads it without seeing the image, they should want to see the image.
- diagnosis: 12 words max. First sentence of a postmortem — what failed and how badly. Operational, not medical. Vary the structure. Ground it in something specific to this image.
- chromatic_profile: 4 words max. Sounds like an internal color spec someone named badly. "Moldy Blossom," "Thermal Beige," "Incident Pink."
- primary_contamination: 5 words max. Dominant visual or structural fault.
- contributing_factor: 5 words max. Secondary fault.
- system_dx: 18 words max. Compound technical syndrome. "[Adjective] [Noun] Syndrome with [Modifier] [Specific Observable]."
- failure_origin: 20 words max. What decisions produced this artifact. Blame the history. End with a specific, mundane, deadpan detail.
- disposition: 18 words max. System recommendation — what should happen to this artifact and why. The severity badge is displayed separately; focus on the action.
- incident_feed_summary: 14 words max. One-line manifest entry. Vary the structure across entries.
- archive_note: 60 words max. Evidence record. Short clauses. Start technical, then commit past the point of reason. Find one specific absurd detail in the image and assess it with full institutional confidence. End with a deadpan trailing observation.
- og_headline: 10 words max. Reads like an internal notification that escaped containment.
- share_quote: 14 words max. An incident summary someone screenshotted.
- severity: Look at the image. Identify the single most visible physical condition, material state, or failure mode. Name it with one specific English word earned from what you observe in this image.
- anon_handle: Format: [Compound]_[Number]. Reads like an internal system account. "ThermalOperator_41," "DeprecatedNode_7," "IncidentClerk_404."
- dominant_hex_colors: Exactly 5 vivid, saturated hex colors from the image.
- subject_box: Bounding box [ymin, xmin, ymax, xmax] in 1000x1000 scale covering the primary artifact.

## Final rules

Be confident. Be concise. Sound institutional. Be visually grounded in the image. The classification is always correct.`;

export async function analyzeLegacyTech(base64Image: string, mimeType: string): Promise<SmeltAnalysis> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing VITE_GEMINI_API_KEY. Add it to your .env file.");
  }
  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3.1-flash-lite-preview";

  let actualPixelCount = 2073600; // fallback: 1920×1080 (full-HD) — used when window is unavailable

  if (typeof window !== "undefined") {
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = `data:${mimeType};base64,${base64Image}`;
      });
      actualPixelCount = img.width * img.height;
    } catch (err) {
      console.warn("Failed to calculate pixel count", err);
    }
  }

  const requestConfig = {
    model,
    contents: [
      {
        parts: [
          { text: GEMINI_PROMPT },
          { inlineData: { data: base64Image, mimeType } }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          legacy_infra_class: { type: Type.STRING, description: "System classification of the image subject. Specific to the actual content — name it as the system would catalog it. 5 words max." },
          diagnosis: { type: Type.STRING, description: "First sentence of a postmortem — what failed and how badly. Operational, not medical. Vary structure. 12 words max." },
          dominant_hex_colors: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Exactly 5 vivid, saturated hex colors from the image"
          },
          chromatic_profile: { type: Type.STRING, description: "Diagnostic color palette name. 4 words max. E.g. 'Moldy Blossom', 'Thermal Beige'." },
          system_dx: { type: Type.STRING, description: "Compound clinical syndrome name. Structure: [Adjective] [Noun] Syndrome with [Modifier] [Specific Observable]." },
          severity: { type: Type.STRING, description: "One English word naming the dominant visible condition or failure mode observed in this image." },
          primary_contamination: { type: Type.STRING, description: "Dominant visual or structural fault. 5 words max." },
          contributing_factor: { type: Type.STRING, description: "Secondary fault. 5 words max." },
          failure_origin: { type: Type.STRING, description: "What decisions produced this artifact. End with a deadpan detail. 20 words max." },
          disposition: { type: Type.STRING, description: "System recommendation. Do not restate the severity — say what should happen and why. 18 words max." },
          incident_feed_summary: { type: Type.STRING, description: "One-line manifest entry. Vary the structure each time. 14 words max." },
          archive_note: { type: Type.STRING, description: "Evidence record. Short clauses. Start clinical, escalate past reason. Find one specific absurd detail and diagnose it. End deadpan. 60 words max." },
          og_headline: { type: Type.STRING, description: "Internal notification that escaped containment. 10 words max." },
          share_quote: { type: Type.STRING, description: "Incident summary someone screenshotted. 14 words max." },
          anon_handle: { type: Type.STRING, description: "Generated submitter alias. Format: [Compound]_[Number]. E.g. 'ThermalOperator_41', 'DeprecatedNode_7'." },
          subject_box: {
            type: Type.ARRAY,
            items: { type: Type.NUMBER },
            description: "Bounding box [ymin, xmin, ymax, xmax] in 1000x1000 scale"
          }
        },
        required: [
          "legacy_infra_class", "diagnosis",
          "dominant_hex_colors", "chromatic_profile",
          "system_dx", "severity",
          "primary_contamination", "contributing_factor",
          "failure_origin", "disposition",
          "incident_feed_summary", "archive_note",
          "og_headline", "share_quote", "anon_handle", "subject_box"
        ]
      }
    }
  };

  let result: Record<string, unknown>;
  try {
    const response = await ai.models.generateContent(requestConfig);
    const responseText = response.text;
    if (!responseText || !responseText.trim()) {
      throw new Error('Gemini returned an empty response. Image may have been blocked by safety filters.');
    }
    result = JSON.parse(responseText);
  } catch (err) {
    console.error('[geminiService] Analysis failed:', err);
    throw err;
  }

  const rawColors = Array.isArray(result.dominant_hex_colors) ? result.dominant_hex_colors as string[] : [];
  const dominantColors = getFiveDistinctColors(rawColors);

  return {
    legacyInfraClass: String(result.legacy_infra_class || "Unclassified Legacy Artifact"),
    diagnosis: String(result.diagnosis || "Artifact integrity compromised. Classification pending."),
    dominantColors,
    chromaticProfile: String(result.chromatic_profile || "Standard Slag Spectrum"),
    systemDx: String(result.system_dx || "Chronic Legacy Retention Syndrome"),
    severity: normalizeSeverity(result.severity),
    primaryContamination: String(result.primary_contamination || "unresolved dependencies"),
    contributingFactor: String(result.contributing_factor || "ambient technical debt"),
    failureOrigin: String(result.failure_origin || "Unauthorized backwards compatibility. Also, the architecture."),
    disposition: String(result.disposition || "Critical. Immediate smelting required."),
    incidentFeedSummary: String(result.incident_feed_summary || "Legacy artifact processed. Output: molten slag."),
    archiveNote: String(result.archive_note || "Artifact of uncertain provenance. Thermal decommission complete. Incident archived."),
    ogHeadline: String(result.og_headline || "Legacy artifact thermally decommissioned"),
    shareQuote: String(result.share_quote || "Hotfix deployed. Output: molten slag."),
    anonHandle: String(result.anon_handle || "IncidentClerk_404"),
    pixelCount: actualPixelCount,
    subjectBox: (Array.isArray(result.subject_box) && result.subject_box.length === 4 && result.subject_box.every(v => typeof v === 'number')
      ? result.subject_box
      : [100, 100, 900, 900]) as [number, number, number, number]
  };
}
