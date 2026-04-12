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

function trimTrailingFractionZeros(value: number): string {
  const fixed = value.toFixed(3);
  const decimalIndex = fixed.indexOf('.');
  if (decimalIndex === -1) return fixed;

  let end = fixed.length;
  while (end > decimalIndex + 1 && fixed[end - 1] === '0') {
    end -= 1;
  }

  if (end === decimalIndex + 1) {
    return fixed.slice(0, decimalIndex);
  }
  return fixed.slice(0, end);
}

export function formatPixels(pixels: number): { value: string, unit: string } {
  if (pixels < 1_000) return { value: pixels.toString(), unit: 'PIXELS' };
  if (pixels < 1_000_000) return { value: trimTrailingFractionZeros(pixels / 1_000), unit: 'KILOPIXELS' };
  if (pixels < 1_000_000_000) return { value: trimTrailingFractionZeros(pixels / 1_000_000), unit: 'MEGAPIXELS' };
  if (pixels < 1_000_000_000_000) return { value: trimTrailingFractionZeros(pixels / 1_000_000_000), unit: 'GIGAPIXELS' };
  if (pixels < 1_000_000_000_000_000) return { value: trimTrailingFractionZeros(pixels / 1_000_000_000_000), unit: 'TERAPIXELS' };
  return { value: trimTrailingFractionZeros(pixels / 1_000_000_000_000_000), unit: 'PETAPIXELS' };
}

export { getFiveDistinctColors } from '../../shared/colors.js';

const APP_BASE_URL_RAW = (import.meta.env.VITE_APP_URL ?? '').trim();
if (!APP_BASE_URL_RAW) {
  throw new Error('Missing required VITE_APP_URL for canonical share links.');
}

let APP_BASE_URL = '';
try {
  APP_BASE_URL = new URL(APP_BASE_URL_RAW).toString().replace(/\/$/, '');
} catch {
  throw new Error(`VITE_APP_URL must be an absolute URL. Received: "${APP_BASE_URL_RAW}"`);
}

// Builds a shareable incident URL from VITE_APP_URL (validated at startup).
// /s/:id is the canonical share path — handled by server.js for OG pre-rendering.
export function buildIncidentUrl(docId: string): string {
  return `${APP_BASE_URL}/s/${encodeURIComponent(docId)}`;
}

export function buildShareLinks(shareText: string, headline: string, pageUrl: string): { label: string; href: string }[] {
  const blueskyText = `${shareText} ${pageUrl}`;
  return [
    { label: 'twitter',  href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(pageUrl)}` },
    { label: 'linkedin', href: `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(pageUrl)}&title=${encodeURIComponent(headline)}&summary=${encodeURIComponent(shareText)}` },
    { label: 'bluesky',  href: `https://bsky.app/intent/compose?text=${encodeURIComponent(blueskyText)}` },
    { label: 'reddit',   href: `https://www.reddit.com/submit?url=${encodeURIComponent(pageUrl)}&title=${encodeURIComponent(headline)}` },
  ];
}

export function getLogShareLinks(log: SmeltLog): { label: string; href: string }[] {
  const incidentUrl = buildIncidentUrl(log.id);
  const shareText = `${log.share_quote}\n\n${log.incident_feed_summary}`;
  return buildShareLinks(shareText, log.og_headline, incidentUrl);
}
