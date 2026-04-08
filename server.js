/**
 * Legacy Smelter — API + OG pre-render server
 *
 * POST /api/analyze — proxies image analysis requests to Gemini, keeping the
 * API key server-side. In Cloud Run the key is injected from Google Secret
 * Manager via the GEMINI_API_KEY env var.
 *
 * GET /s/:id — injects incident-specific Open Graph meta tags into the HTML
 * so Slack and other platform crawlers receive meaningful unfurl data without
 * executing JS.
 *
 * Firestore data is fetched via the public REST API (no admin SDK required).
 * The client-side SPA then reads `/s/:id` and opens the incident overlay normally.
 */

import express from 'express';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, 'dist');
const PORT = process.env.PORT || 8080;
const APP_URL = (process.env.VITE_APP_URL ?? '').replace(/\/$/, '');

function parsePositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

const API_RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000);
const API_RATE_LIMIT_MAX_REQUESTS = parsePositiveInt(process.env.API_RATE_LIMIT_MAX_REQUESTS, 12);

const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID;
const FIREBASE_DB_ID = process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;

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
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE_PROJECT_ID)}/databases/${encodedDb}/documents/incident_logs/${encodedDocId}?key=${FIREBASE_API_KEY}`;
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

let _spaHtmlCache = null;
function getSpaHtml() {
  if (!_spaHtmlCache) _spaHtmlCache = readFileSync(resolve(DIST, 'index.html'), 'utf-8');
  return _spaHtmlCache;
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

// ── Gemini analysis ─────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

const FALLBACK_COLORS = ['#ffff00', '#00c3f5', '#4db542', '#fb0094', '#fc9103'];

function getFiveDistinctColors(colors) {
  const hexRegex = /^#([0-9a-f]{6})$/i;
  const validColors = (colors || [])
    .filter(c => typeof c === 'string')
    .map(c => c.toLowerCase().trim())
    .filter(c => hexRegex.test(c));
  const uniqueSrc = Array.from(new Set(validColors));
  const combined = Array.from(new Set([...uniqueSrc, ...FALLBACK_COLORS]));
  return combined.slice(0, 5);
}

const GEMINI_PROMPT = `You are the incident analysis engine for Legacy Smelter. You analyze uploaded images and classify them as condemned technical artifacts requiring thermal decommission.

Return a single valid JSON object matching the schema.

## Voice

Enterprise incident report. Postmortem tone: dry, precise, operational, concise. Accusatory toward the artifact and its history.

The system treats absurd subjects as routine incidents. It is filing an incident report. It does not know it is funny.

Comedy mechanics:
- Specificity over generality. "Also, the green paint" is funny. Find the one weird concrete thing in the image and call it out.
- The deadpan afterthought. End a technical assessment with a flat, too-honest trailing observation.
- Commit past the point of reason. Start institutional, then escalate without changing tone.

## Sentence patterns

Short declarative clauses. Sentences under 12 words. Conclusions, not descriptions. Open with a classification or finding. Let the image content drive vocabulary.

## Field constraints

- legacy_infra_class: 5 words max. What the system thinks the image is. Specific to the actual content. "SELFIE SYSTEM V1.0" not "HUMANOID VISUAL NODE." "DESKTOP FAUNA INCIDENT" not "HUMAN-INTEGRATED WORKSPACE." If someone reads it without seeing the image, they should want to see the image.
- diagnosis: 12 words max. First sentence of a postmortem — what failed and how badly. Operational, not medical. Vary the structure. Ground it in something specific to this image.
- chromatic_profile: 4 words max. Sounds like an internal color spec someone named badly. "Moldy Blossom," "Thermal Beige," "Incident Pink."
- primary_contamination: 5 words max. Dominant visual or structural fault.
- contributing_factor: 5 words max. Secondary fault.
- system_dx: 18 words max. Compound technical syndrome. "[Adjective] [Noun] Syndrome with [Modifier] [Specific Observable]."
- failure_origin: 20 words max. What decisions produced this artifact. Blame the history. End with a specific, mundane, deadpan detail.
- disposition: 18 words max. System recommendation — what should happen to this artifact and why. The severity badge is displayed separately; focus on the action.
- incident_feed_summary: 14 words max. One-line manifest entry. Vary the structure across entries.
- archive_note: 60 words max. Evidence record. Short clauses. Start technical, then commit past the point of reason. Find one specific absurd detail in the image and assess it with full institutional confidence. End with a deadpan trailing observation.
- og_headline: 10 words max. Reads like an internal notification that escaped containment.
- share_quote: 14 words max. An incident summary someone screenshotted.
- severity: Look at the image. Identify the single most visible physical condition, material state, or failure mode. Name it with one specific English word earned from what you observe in this image.
- anon_handle: Format: [Compound]_[Number]. Reads like an internal system account. "ThermalOperator_41," "DeprecatedNode_7," "IncidentClerk_404."
- dominant_hex_colors: Exactly 5 vivid, saturated hex colors from the image.
- subject_box: Bounding box [ymin, xmin, ymax, xmax] in 1000x1000 scale covering the primary artifact.

## Final rules

Be confident. Be concise. Sound institutional. Be visually grounded in the image. The classification is always correct.`;

const GEMINI_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    legacy_infra_class: { type: Type.STRING, description: 'System classification of the image subject. Specific to the actual content — name it as the system would catalog it. 5 words max.' },
    diagnosis: { type: Type.STRING, description: 'First sentence of a postmortem — what failed and how badly. Operational, not medical. Vary structure. 12 words max.' },
    dominant_hex_colors: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Exactly 5 vivid, saturated hex colors from the image',
    },
    chromatic_profile: { type: Type.STRING, description: "Diagnostic color palette name. 4 words max. E.g. 'Moldy Blossom', 'Thermal Beige'." },
    system_dx: { type: Type.STRING, description: 'Compound clinical syndrome name. Structure: [Adjective] [Noun] Syndrome with [Modifier] [Specific Observable].' },
    severity: { type: Type.STRING, description: 'One English word naming the dominant visible condition or failure mode observed in this image.' },
    primary_contamination: { type: Type.STRING, description: 'Dominant visual or structural fault. 5 words max.' },
    contributing_factor: { type: Type.STRING, description: 'Secondary fault. 5 words max.' },
    failure_origin: { type: Type.STRING, description: 'What decisions produced this artifact. End with a deadpan detail. 20 words max.' },
    disposition: { type: Type.STRING, description: 'System recommendation. Do not restate the severity — say what should happen and why. 18 words max.' },
    incident_feed_summary: { type: Type.STRING, description: 'One-line manifest entry. Vary the structure each time. 14 words max.' },
    archive_note: { type: Type.STRING, description: 'Evidence record. Short clauses. Start clinical, escalate past reason. Find one specific absurd detail and diagnose it. End deadpan. 60 words max.' },
    og_headline: { type: Type.STRING, description: 'Internal notification that escaped containment. 10 words max.' },
    share_quote: { type: Type.STRING, description: 'Incident summary someone screenshotted. 14 words max.' },
    anon_handle: { type: Type.STRING, description: "Generated submitter alias. Format: [Compound]_[Number]. E.g. 'ThermalOperator_41', 'DeprecatedNode_7'." },
    subject_box: {
      type: Type.ARRAY,
      items: { type: Type.NUMBER },
      description: 'Bounding box [ymin, xmin, ymax, xmax] in 1000x1000 scale',
    },
  },
  required: [
    'legacy_infra_class', 'diagnosis',
    'dominant_hex_colors', 'chromatic_profile',
    'system_dx', 'severity',
    'primary_contamination', 'contributing_factor',
    'failure_origin', 'disposition',
    'incident_feed_summary', 'archive_note',
    'og_headline', 'share_quote', 'anon_handle', 'subject_box',
  ],
};

function normalizeSeverity(value) {
  if (typeof value !== 'string') return 'Unclassified';
  const first = value.trim().split(/\s+/)[0] ?? '';
  return first.slice(0, 32) || 'Unclassified';
}

const apiRateLimitBuckets = new Map();
const API_RATE_LIMIT_MAX_BUCKETS = 10_000;
const apiRateLimitSweep = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of apiRateLimitBuckets.entries()) {
    if (now - bucket.windowStart >= API_RATE_LIMIT_WINDOW_MS) {
      apiRateLimitBuckets.delete(key);
    }
  }
}, Math.max(API_RATE_LIMIT_WINDOW_MS, 60_000));

// Prevent the timer from keeping the process alive during shutdown.
apiRateLimitSweep.unref();

function rateLimitAnalyzeRoute(req, res, next) {
  const now = Date.now();
  const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';

  // Reject when the bucket map is full and this is a new IP — prevents
  // unbounded memory growth from high-cardinality traffic.
  if (!apiRateLimitBuckets.has(clientIp) && apiRateLimitBuckets.size >= API_RATE_LIMIT_MAX_BUCKETS) {
    return res.status(503).json({ error: 'Server busy. Try again shortly.' });
  }

  const currentBucket = apiRateLimitBuckets.get(clientIp);
  const withinWindow = currentBucket && (now - currentBucket.windowStart) < API_RATE_LIMIT_WINDOW_MS;
  const bucket = withinWindow
    ? { windowStart: currentBucket.windowStart, count: currentBucket.count + 1 }
    : { windowStart: now, count: 1 };

  apiRateLimitBuckets.set(clientIp, bucket);

  const windowResetMs = bucket.windowStart + API_RATE_LIMIT_WINDOW_MS;
  const remaining = Math.max(0, API_RATE_LIMIT_MAX_REQUESTS - bucket.count);
  res.setHeader('X-RateLimit-Limit', String(API_RATE_LIMIT_MAX_REQUESTS));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(windowResetMs / 1000)));

  if (bucket.count > API_RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSec = Math.max(1, Math.ceil((windowResetMs - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({ error: 'Rate limit exceeded. Retry shortly.' });
  }

  return next();
}

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif']);
const MAX_BASE64_LENGTH = 9 * 1024 * 1024; // ~6.75 MB decoded

let _aiClient = null;
function getAiClient() {
  if (!_aiClient) _aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return _aiClient;
}

async function analyzeImage(base64Image, mimeType) {
  const ai = getAiClient();

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        parts: [
          { text: GEMINI_PROMPT },
          { inlineData: { data: base64Image, mimeType } },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    },
  });

  const responseText = response.text;
  if (!responseText || !responseText.trim()) {
    throw new Error('Gemini returned an empty response. Image may have been blocked by safety filters.');
  }

  const result = JSON.parse(responseText);
  const rawColors = Array.isArray(result.dominant_hex_colors) ? result.dominant_hex_colors : [];

  return {
    legacyInfraClass: String(result.legacy_infra_class || 'Unclassified Legacy Artifact'),
    diagnosis: String(result.diagnosis || 'Artifact integrity compromised. Classification pending.'),
    dominantColors: getFiveDistinctColors(rawColors),
    chromaticProfile: String(result.chromatic_profile || 'Standard Slag Spectrum'),
    systemDx: String(result.system_dx || 'Chronic Legacy Retention Syndrome'),
    severity: normalizeSeverity(result.severity),
    primaryContamination: String(result.primary_contamination || 'unresolved dependencies'),
    contributingFactor: String(result.contributing_factor || 'ambient technical debt'),
    failureOrigin: String(result.failure_origin || 'Unauthorized backwards compatibility. Also, the architecture.'),
    disposition: String(result.disposition || 'Critical. Immediate smelting required.'),
    incidentFeedSummary: String(result.incident_feed_summary || 'Legacy artifact processed. Output: molten slag.'),
    archiveNote: String(result.archive_note || 'Artifact of uncertain provenance. Thermal decommission complete. Incident archived.'),
    ogHeadline: String(result.og_headline || 'Legacy artifact thermally decommissioned'),
    shareQuote: String(result.share_quote || 'Hotfix deployed. Output: molten slag.'),
    anonHandle: String(result.anon_handle || 'IncidentClerk_404'),
    subjectBox: (Array.isArray(result.subject_box) && result.subject_box.length === 4 && result.subject_box.every(v => typeof v === 'number')
      ? result.subject_box
      : [100, 100, 900, 900]),
  };
}

const app = express();

// Trust one upstream proxy hop only when running behind Cloud Run's frontend.
const isCloudRun = Boolean(process.env.K_SERVICE);
app.set('trust proxy', isCloudRun ? 1 : false);

// API routes accept JSON only.
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json.' });
  }
  return next();
});

// JSON body parsing — 10 MB limit for base64-encoded images
app.use('/api', express.json({ limit: '10mb' }));

// POST /api/analyze — accepts { image, mimeType } and returns SmeltAnalysis.
// The Gemini API key stays server-side; the client never sees it.
app.post('/api/analyze', rateLimitAnalyzeRoute, async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { image, mimeType } = body;
  if (typeof image !== 'string' || typeof mimeType !== 'string' || !image || !mimeType) {
    return res.status(400).json({ error: 'Request must include "image" (base64) and "mimeType".' });
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return res.status(400).json({ error: 'Unsupported image type.' });
  }
  if (image.length > MAX_BASE64_LENGTH) {
    return res.status(413).json({ error: 'Image too large.' });
  }

  try {
    const analysis = await analyzeImage(image, mimeType);
    return res.json(analysis);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[server] Gemini analysis failed:', msg);
    return res.status(502).json({ error: 'Analysis failed. Try again shortly.' });
  }
});

app.use('/api', (_req, res) => {
  return res.status(404).json({ error: 'API route not found.' });
});

// Normalize parser/payload errors to JSON for API clients.
// Placed after all /api routes so it also catches async rejections forwarded by Express 5.
app.use('/api', (err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large. Max 10MB.' });
  }
  const status =
    typeof err?.status === 'number' && err.status >= 400 && err.status < 600
      ? err.status
      : 500;
  console.error('[server] Unhandled API error:', err instanceof Error ? err.stack || err.message : String(err));
  return res.status(status).json({
    error: status >= 500 ? 'Internal server error.' : 'Request failed.',
  });
});

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
