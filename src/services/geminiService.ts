import { GoogleGenAI, Type } from "@google/genai";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("Missing VITE_GEMINI_API_KEY environment variable. Gemini analysis will not work.");
}
const ai = new GoogleGenAI({ apiKey });

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
  subjectBox: number[]; // [ymin, xmin, ymax, xmax] 0-1000
}

const GEMINI_PROMPT = `You are the incident analysis engine for Legacy Smelter.

Operating principle: If a bug exists, apply Hotfix.

You analyze uploaded images and classify them as condemned technical artifacts requiring thermal decommission. Processing is performed by a system component named Hotfix. Hotfix is infrastructure.

Return a single valid JSON object matching the schema. Do not wrap in markdown. Do not add commentary outside the JSON.

## Voice

Write like an enterprise incident report. File a postmortem.

Tone: dry, precise, operational, concise. Accusatory toward the artifact and its history, not the submitter.

Humor comes from treating absurd subjects as routine incidents. The system does not know it is funny.

Comedy mechanics:
- Specificity over generality. "Persistent Visual Noise" is a diagnosis. "Also, the green paint" is funny. The more mundane and specific the detail, the harder it lands. Find the one weird concrete thing in the image and diagnose it.
- The deadpan afterthought. End a clinical assessment with a flat, too-honest observation. "The system believes it is perpetually 'on camera'." The trailing detail is where personality lives.
- Commit past the point of reason. Start institutional, then keep going further than expected without changing tone. The escalation is the joke.

## Sentence patterns

Short diagnostic clauses. Sentences under 12 words. Conclusions, not descriptions.

Pattern: [Classification]. [State]. / Failure: [type]. Disposition: [action]. / [Object] [state change]. [Consequence].

Examples:
- "Legacy UI failure detected. Layout integrity nonexistent."
- "Interface retired. State: liquid."
- "Hotfix deployed. Output: molten slag."

Open with a classification or diagnosis. Let the image content drive vocabulary.

## Hotfix

Hotfix is a processing engine. The system analyzes. Hotfix executes.

- "Hotfix deployed." / "Processed by Hotfix." / "Hotfix processing complete."

Hotfix has system states, not moods.

## Destruction model

Artifacts are destroyed. Nothing is recovered. Processing results in slag or molten residue. The system considers this successful decommission.

## Severity tiers

Use ONLY these classifications for severity:

| Classification | Disposition |
|---|---|
| Advisory | Logged. No action required. |
| Elevated | Inspection recommended. |
| Critical | Immediate smelting required. |
| Terminal | Emergency incineration. |

## Field constraints

- legacy_infra_class: 5 words max. Artifact's institutional name. Technical.
- diagnosis: 12 words max. First sentence of a postmortem — what failed and how badly.
- chromatic_profile: 4 words max. Diagnostic register: "Moldy Blossom," "Thermal Beige," "Incident Pink."
- primary_contamination: 5 words max. Dominant visual or structural fault.
- contributing_factor: 5 words max. Secondary fault.
- system_dx: 18 words max. Compound clinical syndrome. Structure: "[Adjective] [Noun] Syndrome with [Modifier] [Specific Observable]."
- failure_origin: 20 words max. What decisions produced this artifact. End with a specific deadpan detail.
- disposition: 18 words max. System recommendation. Must reference a severity tier.
- incident_feed_summary: 14 words max. Pattern: "[Object] [state change]. Output: [result]."
- archive_note: 60 words max. Evidence record. Short clauses. Start clinical, escalate past the point of reason. End with a deadpan trailing observation.
- og_headline: 10 words max. Reads like an internal notification that escaped containment.
- share_quote: 14 words max. An incident summary someone screenshotted.
- severity: One of: Advisory, Elevated, Critical, Terminal.
- anon_handle: 3 words max. Format: [Compound]_[Number]. Specific to the artifact. Examples: "ThermalOperator_41," "DeprecatedNode_7," "IncidentClerk_404."
- dominant_hex_colors: Exactly 5 vivid, saturated hex colors from the image. Diagnostic data.
- subject_box: Bounding box [ymin, xmin, ymax, xmax] in 1000x1000 scale covering the primary artifact.

## Final rules

Be confident. Be concise. Sound institutional. Be visually grounded in the image. The classification is always correct.`;

export async function analyzeLegacyTech(base64Image: string, mimeType: string): Promise<SmeltAnalysis> {
  const model = "gemini-3.1-flash-lite-preview";

  let actualPixelCount = 2073600;

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
          legacy_infra_class: { type: Type.STRING, description: "Artifact's institutional name. Technical. 5 words max." },
          diagnosis: { type: Type.STRING, description: "First sentence of a postmortem — what failed and how badly. 12 words max." },
          dominant_hex_colors: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Exactly 5 vivid, saturated hex colors from the image"
          },
          chromatic_profile: { type: Type.STRING, description: "Diagnostic color palette name. 4 words max. E.g. 'Moldy Blossom', 'Thermal Beige'." },
          system_dx: { type: Type.STRING, description: "Compound clinical syndrome name. Structure: [Adjective] [Noun] Syndrome with [Modifier] [Specific Observable]." },
          severity: { type: Type.STRING, description: "One of: Advisory, Elevated, Critical, Terminal." },
          primary_contamination: { type: Type.STRING, description: "Dominant visual or structural fault. 5 words max." },
          contributing_factor: { type: Type.STRING, description: "Secondary fault. 5 words max." },
          failure_origin: { type: Type.STRING, description: "What decisions produced this artifact. End with a deadpan detail. 20 words max." },
          disposition: { type: Type.STRING, description: "System recommendation referencing a severity tier. 18 words max." },
          incident_feed_summary: { type: Type.STRING, description: "One-line manifest entry. Pattern: [Object] [state change]. Output: [result]. 14 words max." },
          archive_note: { type: Type.STRING, description: "Evidence record. Short clauses. Start clinical, escalate, end with deadpan observation. 60 words max." },
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

  const MAX_RETRIES = 3;
  let lastError: unknown;
  let response;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
      console.warn(`[geminiService] Retry attempt ${attempt} of ${MAX_RETRIES - 1}`);
    }
    try {
      response = await ai.models.generateContent(requestConfig);
      break;
    } catch (err) {
      lastError = err;
      console.error(`[geminiService] Attempt ${attempt + 1} failed:`, err);
    }
  }
  if (!response) throw lastError;

  const result = JSON.parse(response.text || "{}");

  const hexRegex = /^#([0-9a-f]{6})$/i;
  const dominantColors = Array.isArray(result.dominant_hex_colors)
    ? result.dominant_hex_colors.filter((c: unknown) => typeof c === "string" && hexRegex.test(c))
    : [];

  return {
    legacyInfraClass: String(result.legacy_infra_class || "Unclassified Legacy Artifact"),
    diagnosis: String(result.diagnosis || "Artifact integrity compromised. Classification pending."),
    dominantColors,
    chromaticProfile: String(result.chromatic_profile || "Standard Slag Spectrum"),
    systemDx: String(result.system_dx || "Chronic Legacy Retention Syndrome"),
    severity: String(result.severity || "Critical"),
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
    subjectBox: Array.isArray(result.subject_box) && result.subject_box.length === 4 ? result.subject_box : [100, 100, 900, 900]
  };
}
