import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { SmeltLog } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Server is us-east1 (America/New_York). Format: 2026.04.05 // 21:19:01 EST
const _tsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

export function formatTimestamp(date: Date): string {
  const p = Object.fromEntries(_tsFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${p.year}.${p.month}.${p.day} // ${p.hour}:${p.minute}:${p.second} ${p.timeZoneName}`;
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
const DEFAULT_APP_URL = 'https://hotfix.anchildress1.dev';

// Builds a shareable incident URL. Uses VITE_APP_URL when provided.
// Falls back to the canonical production URL so links stay stable across hostnames.
// /s/:id is the canonical share path — handled by server.js for OG pre-rendering.
export function buildIncidentUrl(docId: string): string {
  const base = (import.meta.env.VITE_APP_URL || DEFAULT_APP_URL).replace(/\/$/, '');
  return `${base}/s/${encodeURIComponent(docId)}`;
}

export function buildShareLinks(shareText: string, headline: string, pageUrl: string): { label: string; href: string }[] {
  return [
    { label: 'twitter',  href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(pageUrl)}` },
    { label: 'linkedin', href: `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(pageUrl)}&title=${encodeURIComponent(headline)}&summary=${encodeURIComponent(shareText)}` },
    { label: 'bluesky',  href: `https://bsky.app/intent/compose?text=${encodeURIComponent(`${shareText} ${pageUrl}`)}` },
    { label: 'reddit',   href: `https://www.reddit.com/submit?url=${encodeURIComponent(pageUrl)}&title=${encodeURIComponent(headline)}` },
  ];
}

export function getLogShareLinks(log: SmeltLog): { label: string; href: string }[] {
  const incidentUrl = buildIncidentUrl(log.id);
  const shareText = log.share_quote
    ? `${log.share_quote}\n\n${log.incident_feed_summary}`
    : log.incident_feed_summary;
  const headline = log.og_headline || 'Legacy Smelter Incident Report';
  return buildShareLinks(shareText, headline, incidentUrl);
}

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
