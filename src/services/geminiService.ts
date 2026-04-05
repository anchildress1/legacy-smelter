import { GoogleGenAI, Type } from "@google/genai";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("Missing VITE_GEMINI_API_KEY environment variable. Gemini analysis will not work.");
}
const ai = new GoogleGenAI({ apiKey });

export interface SmeltAnalysis {
  legacyInfraClass: string;
  legacyInfraDescription: string;
  dominantColors: string[];
  paletteName: string;
  cursedDx: string;
  smeltRating: string;
  dominantContamination: string;
  secondaryContamination: string;
  rootCause: string;
  salvageability: string;
  damageReport: string;
  museumCaption: string;
  ogHeadline: string;
  ogDescription: string;
  shareQuote: string;
  anonHandle: string;
  pixelCount: number;
  subjectBox: number[]; // [ymin, xmin, ymax, xmax] 0-1000
}

const GEMINI_PROMPT = `You are the analysis engine for **Legacy Smelter**, a satirical web app that "solves" problematic legacy systems by smelting screenshots and old technology into molten slag.

You will receive an uploaded image. Treat it as a piece of cursed legacy infrastructure, unstable software, outdated hardware, or a suspiciously haunted technical artifact. Each submission becomes an official **incident report** filed in the Global Incident Manifest.

Your task is to analyze the image and return a **single valid JSON object** matching the schema below.

Requirements:
- Be visually grounded in the image.
- Be funny, but specific.
- Prefer short, punchy phrases over long paragraphs.
- Do not mention policy, safety, or that you are an AI.
- Do not wrap output in markdown.
- Do not add commentary outside the JSON.
- The result should feel like an official incident postmortem written by an overconfident enterprise disaster analyst who fully supports dragon-based remediation.
- Also return a bounding box [ymin, xmin, ymax, xmax] using a 1000x1000 grid representing the primary subject of the image to smelt.

Return the result in JSON format.`;

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
          legacy_infra_class: { type: Type.STRING, description: "Short class name for the artifact as legacy infrastructure" },
          legacy_infra_description: { type: Type.STRING, description: "1-2 sentence description of what the artifact is and why it is smelt-worthy" },
          dominant_hex_colors: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Exactly 5 visually grounded dominant hex colors from the image"
          },
          palette_name: { type: Type.STRING, description: "Short dramatic name for the color palette" },
          cursed_dx: { type: Type.STRING, description: "Cursed diagnosis for the artifact" },
          smelt_rating: { type: Type.STRING, description: "Severity rating for how badly this needs smelting" },
          dominant_contamination: { type: Type.STRING, description: "Main corrupting force detected" },
          secondary_contamination: { type: Type.STRING, description: "Secondary corrupting force" },
          root_cause: { type: Type.STRING, description: "Fake-but-funny incident root cause statement" },
          salvageability: { type: Type.STRING, description: "Verdict on whether the artifact can be saved" },
          damage_report: { type: Type.STRING, description: "Punchy one-line damage report for result cards" },
          museum_caption: { type: Type.STRING, description: "Longer caption for the public Museum of Damage" },
          og_headline: { type: Type.STRING, description: "Short social-share-friendly headline" },
          share_quote: { type: Type.STRING, description: "Punchy line for prefilled social share text" },
          anon_handle: { type: Type.STRING, description: "A hilarious anonymous username for the person who submitted this artifact, e.g. 'CursedSysadmin_42', 'PrinterWhisperer', 'LegacyGoblin9000'. Should be funny, specific to the artifact, and feel like a gamertag from someone who has seen too many legacy systems." },
          subject_box: {
            type: Type.ARRAY,
            items: { type: Type.NUMBER },
            description: "Bounding box [ymin, xmin, ymax, xmax] in 1000x1000 scale"
          }
        },
        required: [
          "legacy_infra_class", "legacy_infra_description",
          "dominant_hex_colors",
          "palette_name", "cursed_dx", "smelt_rating",
          "dominant_contamination", "secondary_contamination", "root_cause",
          "salvageability", "damage_report", "museum_caption",
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

  const damageReport = String(result.damage_report || "LEGACY HARDWARE PURGED. SMELT IMMINENT.");

  return {
    legacyInfraClass: String(result.legacy_infra_class || "Unclassified Legacy Artifact"),
    legacyInfraDescription: String(result.legacy_infra_description || "Origin unknown. Smelt recommended."),
    dominantColors,
    paletteName: String(result.palette_name || "Standard Slag Spectrum"),
    cursedDx: String(result.cursed_dx || "Chronic Legacy Retention"),
    smeltRating: String(result.smelt_rating || "High Priority Smelt"),
    dominantContamination: String(result.dominant_contamination || "unresolved dependencies"),
    secondaryContamination: String(result.secondary_contamination || "ambient technical debt"),
    rootCause: String(result.root_cause || "Unauthorized backwards compatibility"),
    salvageability: String(result.salvageability || "Unsalvageable"),
    damageReport,
    museumCaption: String(result.museum_caption || "A relic of uncertain provenance, ceremonially destroyed."),
    ogHeadline: String(result.og_headline || "Legacy Smelter: Dragon Intervention Complete"),
    ogDescription: damageReport,
    shareQuote: String(result.share_quote || "I just smelted legacy tech with a dragon. You're welcome."),
    anonHandle: String(result.anon_handle || "AnonymousSmelter"),
    pixelCount: actualPixelCount,
    subjectBox: Array.isArray(result.subject_box) && result.subject_box.length === 4 ? result.subject_box : [100, 100, 900, 900]
  };
}
