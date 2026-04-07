/**
 * Legacy Smelter — OG pre-render server
 *
 * Serves the built SPA for all routes. For `/s/:id` requests, injects
 * incident-specific Open Graph meta tags into the HTML so Slack and other
 * platform crawlers receive meaningful unfurl data without executing JS.
 *
 * Firestore data is fetched via the public REST API (no admin SDK required).
 * The client-side SPA then reads `/s/:id` and opens the incident overlay normally.
 */

import express from 'express';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, 'dist');
const PORT = process.env.PORT || 8080;
const DEFAULT_APP_URL = 'https://hotfix.anchildress1.dev';
const APP_URL = (process.env.VITE_APP_URL || DEFAULT_APP_URL).replace(/\/$/, '');

const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID;
const FIREBASE_DB_ID = process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || '(default)';

// GitHub banner used as the og:image for all incident shares
const OG_IMAGE = 'https://repository-images.githubusercontent.com/1201373945/f2802097-2afe-4c31-848f-a94cc13ca0b1';
const OG_IMAGE_WIDTH = '1376';
const OG_IMAGE_HEIGHT = '688';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchIncident(docId) {
  const encodedDb = encodeURIComponent(FIREBASE_DB_ID);
  const encodedDocId = encodeURIComponent(docId);
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${encodedDb}/documents/incident_logs/${encodedDocId}?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.fields) return null;
  const str = (k) => data.fields[k]?.stringValue ?? '';
  return {
    og_headline: str('og_headline'),
    incident_feed_summary: str('incident_feed_summary'),
    severity: str('severity'),
    legacy_infra_class: str('legacy_infra_class'),
  };
}

let _spaHtml = null;
function getSpaHtml() {
  if (!_spaHtml) _spaHtml = readFileSync(resolve(DIST, 'index.html'), 'utf-8');
  return _spaHtml;
}

function injectIncidentOg(html, incident, canonicalUrl) {
  const title = `${incident.og_headline} — Legacy Smelter`;
  const rawDesc = `[${incident.severity}] ${incident.legacy_infra_class}: ${incident.incident_feed_summary}`;
  const desc = rawDesc.slice(0, 300);
  const imageAlt = `${incident.og_headline} — ${incident.severity} incident`;

  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${esc(desc)}"`)
    .replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${esc(title)}"`)
    .replace(/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${esc(desc)}"`)
    .replace(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${esc(canonicalUrl)}"`)
    .replace(/<meta property="og:image" content="[^"]*"/, `<meta property="og:image" content="${OG_IMAGE}"`)
    .replace(/<meta property="og:image:width" content="[^"]*"/, `<meta property="og:image:width" content="${OG_IMAGE_WIDTH}"`)
    .replace(/<meta property="og:image:height" content="[^"]*"/, `<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}"`)
    .replace(/<meta property="og:image:alt" content="[^"]*"/, `<meta property="og:image:alt" content="${esc(imageAlt)}"`)
    .replace(/<meta property="og:type" content="[^"]*"/, `<meta property="og:type" content="article"`)
    .replace(/<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${esc(title)}"`)
    .replace(/<meta name="twitter:description" content="[^"]*"/, `<meta name="twitter:description" content="${esc(desc)}"`)
    .replace(/<meta name="twitter:image" content="[^"]*"/, `<meta name="twitter:image" content="${OG_IMAGE}"`)
    .replace(/<meta name="twitter:image:alt" content="[^"]*"/, `<meta name="twitter:image:alt" content="${esc(imageAlt)}"`);
}

const app = express();

// Incident share URLs: /s/:id
// Injects incident-specific OG meta tags so Slack, X, LinkedIn etc. unfurl correctly.
// Crawlers stop at the meta tags; browsers get the full SPA and the React app
// reads window.location.pathname to open the incident overlay.
app.get('/s/:id', async (req, res, next) => {
  const { id } = req.params;
  if (!FIREBASE_API_KEY || !FIREBASE_PROJECT_ID) return next();

  try {
    const incident = await fetchIncident(id);
    if (!incident?.og_headline) return next();

    const canonicalUrl = `${APP_URL}/s/${encodeURIComponent(id)}`;
    const html = injectIncidentOg(getSpaHtml(), incident, canonicalUrl);
    res.setHeader('Content-Type', 'text/html');
    // CDN caches for 24h; browsers revalidate after 1h.
    // Incident data is immutable after write, so long CDN TTL is safe.
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    return res.send(html);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[server] OG render failed for id=%s: %s', id, msg);
    return next();
  }
});

// Vite hashes all asset filenames — safe to cache for 1 year.
// index.html is excluded: it must stay fresh so app updates propagate.
app.use(express.static(DIST, {
  maxAge: '1y',
  immutable: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

// SPA fallback for client-side routing.
// Uses app.use instead of wildcard route string for Express 5 compatibility.
app.use((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-store');
  res.send(getSpaHtml());
});

app.listen(PORT, () => {
  console.log(`[server] Legacy Smelter on port ${PORT}`);
});
