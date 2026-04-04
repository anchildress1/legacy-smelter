import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface SmeltAnalysis {
  dominantColors: string[];
  damageReport: string;
  pixelCount: number;
}

export async function analyzeLegacyTech(base64Image: string, mimeType: string): Promise<SmeltAnalysis> {
  const model = "gemini-3.1-flash-lite-preview";
  
  const prompt = `Analyze this piece of legacy technology. 
  1. Extract 5 dominant hex colors that represent its decay, rust, or outdated materials.
  2. Generate a chaotic, industrial damage report (max 20 words) describing its reduction to smelted materials. Example: "12.1M pixels of cursed machinery successfully smelted!"
  3. Estimate the pixel area if this were a standard 1080p capture (width * height).
  
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
          pixelCount: {
            type: Type.NUMBER,
            description: "Estimated pixel area"
          }
        },
        required: ["dominantColors", "damageReport", "pixelCount"]
      }
    }
  });

  const result = JSON.parse(response.text || "{}");
  return {
    dominantColors: result.dominantColors || ["#eab308", "#38bdf8", "#27272a", "#18181b", "#52525b"],
    damageReport: result.damageReport || "LEGACY HARDWARE PURGED. SMELT IMMINENT.",
    pixelCount: result.pixelCount || 2073600
  };
}
