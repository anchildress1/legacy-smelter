import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPixels(pixels: number): { value: string, unit: string } {
  if (pixels < 1_000) return { value: pixels.toString(), unit: 'PIXELS' };
  if (pixels < 1_000_000) return { value: (pixels / 1_000).toFixed(3).replace(/\.?0+$/, ''), unit: 'KILOPIXELS' };
  if (pixels < 1_000_000_000) return { value: (pixels / 1_000_000).toFixed(3).replace(/\.?0+$/, ''), unit: 'MEGAPIXELS' };
  if (pixels < 1_000_000_000_000) return { value: (pixels / 1_000_000_000).toFixed(3).replace(/\.?0+$/, ''), unit: 'GIGAPIXELS' };
  if (pixels < 1_000_000_000_000_000) return { value: (pixels / 1_000_000_000_000).toFixed(3).replace(/\.?0+$/, ''), unit: 'TERAPIXELS' };
  return { value: (pixels / 1_000_000_000_000_000).toFixed(3).replace(/\.?0+$/, ''), unit: 'PETAPIXELS' };
}

export const FALLBACK_COLORS = ["#ffff00", "#00c3f5", "#4db542", "#fb0094", "#fc9103"];

export function getFiveDistinctColors(colors: string[]): string[] {
  const hexRegex = /^#([0-9a-f]{6})$/i;
  const validColors = (colors || [])
    .filter(c => typeof c === 'string')
    .map(c => c.toLowerCase().trim())
    .filter(c => hexRegex.test(c));
    
  const uniqueSrc = Array.from(new Set(validColors));
  const combined = Array.from(new Set([...uniqueSrc, ...FALLBACK_COLORS]));
  return combined.slice(0, 5);
}
