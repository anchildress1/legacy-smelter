import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || "" });

export interface SmeltAnalysis {
  dominantColors: string[];
  damageReport: string;
  pixelCount: number;
  subjectBox: number[]; // [ymin, xmin, ymax, xmax] 0-1000
}

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
      console.warn("Failed to calculate programmatic pixel count", err);
    }
  }

  const prompt = `Analyze this piece of legacy technology. 
  1. Extract 5 dominant hex colors that represent its decay, rust, or outdated materials without duplicates.
  2. Generate a chaotic, industrial damage report (max 20 words) describing its reduction to smelted materials. Example: "12.1M pixels of cursed machinery successfully smelted!"
  3. Return a bounding box [ymin, xmin, ymax, xmax] using a 1000x1000 grid representing the primary subject of the image to smelt.
  
  Return the result in JSON format.`;

  const response = await ai.models.generateContent({
    model,
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
          dominantColors: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "5 hex color strings"
          },
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
        required: ["dominantColors", "damageReport", "subjectBox"]
      }
    }
  });

  const result = JSON.parse(response.text || "{}");
  return {
    dominantColors: Array.isArray(result.dominantColors) ? result.dominantColors : ["#eab308", "#38bdf8", "#27272a", "#18181b", "#52525b"],
    damageReport: String(result.damageReport || "LEGACY HARDWARE PURGED. SMELT IMMINENT."),
    pixelCount: actualPixelCount,
    subjectBox: Array.isArray(result.subjectBox) && result.subjectBox.length === 4 ? result.subjectBox : [100, 100, 900, 900]
  };
}
