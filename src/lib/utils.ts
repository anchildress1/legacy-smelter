import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPixels(pixels: number): { value: string, unit: string } {
  if (pixels < 1_000) return { value: pixels.toString(), unit: 'PX' };
  if (pixels < 1_000_000) return { value: (pixels / 1_000).toFixed(3).replace(/\.?0+$/, ''), unit: 'K PX' };
  if (pixels < 1_000_000_000) return { value: (pixels / 1_000_000).toFixed(3).replace(/\.?0+$/, ''), unit: 'M PX' };
  if (pixels < 1_000_000_000_000) return { value: (pixels / 1_000_000_000).toFixed(3).replace(/\.?0+$/, ''), unit: 'G PX' };
  if (pixels < 1_000_000_000_000_000) return { value: (pixels / 1_000_000_000_000).toFixed(3).replace(/\.?0+$/, ''), unit: 'T PX' };
  return { value: (pixels / 1_000_000_000_000_000).toFixed(3).replace(/\.?0+$/, ''), unit: 'P PX' };
}
