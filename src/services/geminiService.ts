import { GoogleGenAI, Type } from "@google/genai";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("Missing VITE_GEMINI_API_KEY environment variable. Gemini analysis will not work.");
}
const ai = new GoogleGenAI({ apiKey });

const MODEL = "gemini-3.1-flash-lite-preview";
const MAX_RETRIES = 3;

export interface SmeltAnalysis {
  dominantColors: string[];
  damageReport: string;
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

async function callGeminiWithRetry(base64Image: string, mimeType: string): Promise<{ damageReport: string; subjectBox: number[] }> {
  const prompt = `Analyze this piece of legacy technology.
  1. Generate a chaotic, industrial damage report (max 20 words) describing the object's reduction to smelted materials. Example: "12.1M pixels of cursed machinery successfully smelted!"
  2. Return a bounding box [ymin, xmin, ymax, xmax] using a 1000x1000 grid representing the primary subject of the image to smelt.

  Return the result in JSON format.`;

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
      console.warn(`[geminiService] Retry attempt ${attempt} of ${MAX_RETRIES - 1}`);
    }

    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { data: base64Image, mimeType } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              damageReport: {
                type: Type.STRING,
                description: "A chaotic damage report"
              },
              subjectBox: {
                type: Type.ARRAY,
                items: { type: Type.NUMBER },
                description: "Bounding box [ymin, xmin, ymax, xmax] in 1000x1000 scale"
              }
            },
            required: ["damageReport", "subjectBox"]
          }
        }
      });

      let responseText: string;
      try {
        responseText = response.text || "{}";
      } catch (textErr) {
        // response.text throws when the response was blocked by safety filters
        throw new Error(`Gemini response blocked: ${textErr instanceof Error ? textErr.message : String(textErr)}`);
      }

      let result: { damageReport?: unknown; subjectBox?: unknown };
      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error(`Gemini returned unparseable JSON: ${responseText.slice(0, 100)}`);
      }

      return {
        damageReport: String(result.damageReport || "LEGACY HARDWARE PURGED. SMELT IMMINENT."),
        subjectBox: Array.isArray(result.subjectBox) && result.subjectBox.length === 4
          ? result.subjectBox
          : [100, 100, 900, 900],
      };
    } catch (err) {
      lastError = err;
      console.error(`[geminiService] Attempt ${attempt + 1} failed:`, err);
    }
  }

  throw lastError;
}

export async function analyzeLegacyTech(base64Image: string, mimeType: string): Promise<SmeltAnalysis> {
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

  const { damageReport, subjectBox } = await callGeminiWithRetry(base64Image, mimeType);

  return {
    dominantColors: programmaticColors,
    damageReport,
    pixelCount: actualPixelCount,
    subjectBox,
  };
}
