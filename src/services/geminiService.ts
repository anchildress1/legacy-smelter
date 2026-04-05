import { GoogleGenAI, Type } from "@google/genai";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("Missing VITE_GEMINI_API_KEY environment variable. Gemini analysis will not work.");
}
const ai = new GoogleGenAI({ apiKey });

export interface SmeltAnalysis {
  legacyInfraClass: string;
  legacyInfraDescription: string;
  visualSummary: string;
  confidence: number;
  dominantColors: string[];
  dominantColorsFallback: string[];
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
  pixelCount: number;
  subjectBox: number[]; // [ymin, xmin, ymax, xmax] 0-1000
}

function extractDominantColors(img: HTMLImageElement, count: number): string[] {
  const canvas = document.createElement("canvas");
  const MAX_DIM = 200;
  let w = img.width;
  let h = img.height;
  if (w > h && w > MAX_DIM) {
    h = Math.floor(h * (MAX_DIM / w));
    w = MAX_DIM;
  } else if (h > w && h > MAX_DIM) {
    w = Math.floor(w * (MAX_DIM / h));
    h = MAX_DIM;
  }

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const colorMap: Record<string, { r: number, g: number, b: number, score: number }> = {};

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i+1];
    const b = data[i+2];
    const a = data[i+3];
    if (a < 128) continue;

    // Calculate saturation-based weight to suppress grays
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const saturation = max === 0 ? 0 : (max - min) / max;
    // Boost score significantly for vibrant colors
    const weight = 1 + (saturation * 5);

    const qR = Math.floor(r / 16) * 16;
    const qG = Math.floor(g / 16) * 16;
    const qB = Math.floor(b / 16) * 16;
    const key = `${qR},${qG},${qB}`;

    if (!colorMap[key]) {
      colorMap[key] = { r: qR, g: qG, b: qB, score: 0 };
    }
    colorMap[key].score += weight;
  }

  const sortedClusters = Object.values(colorMap).sort((a, b) => b.score - a.score);
  const distinctColors: string[] = [];
  const minDistance = 40;

  for (const cluster of sortedClusters) {
    if (distinctColors.length >= count) break;
    let isDistinct = true;
    for (const existingHex of distinctColors) {
      const er = parseInt(existingHex.slice(1, 3), 16);
      const eg = parseInt(existingHex.slice(3, 5), 16);
      const eb = parseInt(existingHex.slice(5, 7), 16);
      const dist = Math.sqrt(Math.pow(cluster.r - er, 2) + Math.pow(cluster.g - eg, 2) + Math.pow(cluster.b - eb, 2));
      if (dist < minDistance) {
        isDistinct = false;
        break;
      }
    }

    if (isDistinct) {
      const hex = "#" + [cluster.r, cluster.g, cluster.b]
        .map(c => Math.min(255, c + 8).toString(16).padStart(2, "0"))
        .join("");
      distinctColors.push(hex);
    }
  }
  return distinctColors;
}

const GEMINI_PROMPT = `You are the analysis engine for **Legacy Smelter**, a satirical web app that "solves" problematic legacy systems by smelting screenshots and old technology into molten slag.

You will receive an uploaded image. Treat it as a piece of cursed legacy infrastructure, unstable software, outdated hardware, or a suspiciously haunted technical artifact.

Your task is to analyze the image and return a **single valid JSON object** matching the schema below.

Requirements:
- Be visually grounded in the image.
- Be funny, but specific.
- Prefer short, punchy phrases over long paragraphs.
- Do not mention policy, safety, or that you are an AI.
- Do not wrap output in markdown.
- Do not add commentary outside the JSON.
- If visual certainty is low, still make your best humorous classification while marking confidence appropriately.
- The result should feel like an official damage report written by an overconfident enterprise disaster analyst who fully supports dragon-based remediation.
- Also return a bounding box [ymin, xmin, ymax, xmax] using a 1000x1000 grid representing the primary subject of the image to smelt.

Return the result in JSON format.`;

export async function analyzeLegacyTech(base64Image: string, mimeType: string): Promise<SmeltAnalysis> {
  const model = "gemini-2.5-flash";

  let actualPixelCount = 2073600;
  let programmaticColors: string[] = [];

  if (typeof window !== "undefined") {
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = `data:${mimeType};base64,${base64Image}`;
      });
      actualPixelCount = img.width * img.height;
      programmaticColors = extractDominantColors(img, 5);
    } catch (err) {
      console.warn("Failed to calculate programmatic image properties", err);
    }
  }

  const response = await ai.models.generateContent({
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
          visual_summary: { type: Type.STRING, description: "Short plain-language description of the visible contents" },
          confidence: { type: Type.INTEGER, description: "0-100 confidence in visual interpretation" },
          dominant_hex_colors: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Exactly 5 visually grounded dominant hex colors from the image"
          },
          dominant_hex_colors_fallback: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Exactly 5 fallback hex colors if primary palette is too muted"
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
          og_description: { type: Type.STRING, description: "Short social-share-friendly description" },
          share_quote: { type: Type.STRING, description: "Punchy line for prefilled social share text" },
          subject_box: {
            type: Type.ARRAY,
            items: { type: Type.NUMBER },
            description: "Bounding box [ymin, xmin, ymax, xmax] in 1000x1000 scale"
          }
        },
        required: [
          "legacy_infra_class", "legacy_infra_description", "visual_summary",
          "confidence", "dominant_hex_colors", "dominant_hex_colors_fallback",
          "palette_name", "cursed_dx", "smelt_rating",
          "dominant_contamination", "secondary_contamination", "root_cause",
          "salvageability", "damage_report", "museum_caption",
          "og_headline", "og_description", "share_quote", "subject_box"
        ]
      }
    }
  });

  const result = JSON.parse(response.text || "{}");

  // Use programmatic colors as primary (faster, more accurate), Gemini colors as creative fallback
  // Spec heuristic: if confidence < 45, blend 2 programmatic with 3 fallback
  const geminiColors: string[] = Array.isArray(result.dominant_hex_colors) ? result.dominant_hex_colors : [];
  const geminiFallback: string[] = Array.isArray(result.dominant_hex_colors_fallback) ? result.dominant_hex_colors_fallback : [];
  const confidence = typeof result.confidence === "number" ? result.confidence : 50;

  let finalColors: string[];
  if (programmaticColors.length >= 3) {
    if (confidence < 45) {
      finalColors = [...programmaticColors.slice(0, 2), ...geminiFallback.slice(0, 3)];
    } else {
      finalColors = programmaticColors;
    }
  } else {
    finalColors = geminiColors.length >= 5 ? geminiColors : geminiFallback;
  }

  return {
    legacyInfraClass: String(result.legacy_infra_class || "Unclassified Legacy Artifact"),
    legacyInfraDescription: String(result.legacy_infra_description || "Origin unknown. Smelt recommended."),
    visualSummary: String(result.visual_summary || "Visual analysis inconclusive."),
    confidence,
    dominantColors: finalColors,
    dominantColorsFallback: geminiFallback,
    paletteName: String(result.palette_name || "Standard Slag Spectrum"),
    cursedDx: String(result.cursed_dx || "Chronic Legacy Retention"),
    smeltRating: String(result.smelt_rating || "High Priority Smelt"),
    dominantContamination: String(result.dominant_contamination || "unresolved dependencies"),
    secondaryContamination: String(result.secondary_contamination || "ambient technical debt"),
    rootCause: String(result.root_cause || "Unauthorized backwards compatibility"),
    salvageability: String(result.salvageability || "Unsalvageable"),
    damageReport: String(result.damage_report || "LEGACY HARDWARE PURGED. SMELT IMMINENT."),
    museumCaption: String(result.museum_caption || "A relic of uncertain provenance, ceremonially destroyed."),
    ogHeadline: String(result.og_headline || "Legacy Smelter: Dragon Intervention Complete"),
    ogDescription: String(result.og_description || "Another piece of legacy tech reduced to ceremonial slag."),
    shareQuote: String(result.share_quote || "I just smelted legacy tech with a dragon. You're welcome."),
    pixelCount: actualPixelCount,
    subjectBox: Array.isArray(result.subject_box) && result.subject_box.length === 4 ? result.subject_box : [100, 100, 900, 900]
  };
}
