/**
 * Audience Favorite cron script.
 *
 * Picks the 5 most recent unjudged incidents, sends them to Gemini
 * for scoring, and awards the winner an escalation vote.
 *
 * Run: npx tsx scripts/audience-favorite.ts
 * Env: GEMINI_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_FIRESTORE_DATABASE_ID,
 *       GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT_JSON)
 */

import 'dotenv/config';
import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Config ──────────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_ID = process.env.FIREBASE_FIRESTORE_DATABASE_ID || process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
const MIN_BATCH = 5;
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

if (!GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');
if (!PROJECT_ID) throw new Error('Missing FIREBASE_PROJECT_ID');
if (!DATABASE_ID) throw new Error('Missing FIREBASE_FIRESTORE_DATABASE_ID');

// ── Firebase Admin init ─────────────────────────────────────────────────

function getServiceAccountCredential(): ServiceAccount | undefined {
  // Option 1: JSON string in env var (for CI)
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) return JSON.parse(json) as ServiceAccount;

  // Option 2: GOOGLE_APPLICATION_CREDENTIALS file path (standard)
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) return JSON.parse(readFileSync(credPath, 'utf-8')) as ServiceAccount;

  // Option 3: Default credentials (Cloud Run, etc.)
  return undefined;
}

const credential = getServiceAccountCredential();
initializeApp(credential ? { credential: cert(credential), projectId: PROJECT_ID } : { projectId: PROJECT_ID });

const db = getFirestore(DATABASE_ID);

// ── Load judging prompt from docs ───────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const JUDGING_PROMPT = readFileSync(resolve(__dirname, '../docs/judging-prompt.md'), 'utf-8');

// ── Types ───────────────────────────────────────────────────────────────

interface IncidentDoc {
  uid: string;
  legacy_infra_class: string;
  diagnosis: string;
  severity: string;
  archive_note: string;
  failure_origin: string;
  chromatic_profile: string;
  system_dx: string;
  incident_feed_summary: string;
  share_quote: string;
  timestamp: Timestamp;
  escalation_count: number;
  breach_count: number;
}

interface JudgingResult {
  winner: string;
  rationale: string;
}

interface CronState {
  last_judged_timestamp: Timestamp;
}

// ── Main ────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log('[audience-favorite] Starting run...');

  // 1. Get last judged timestamp (or epoch if first run)
  const stateRef = db.collection('cron_state').doc('audience_favorite');
  const stateSnap = await stateRef.get();
  const lastJudged: Timestamp = stateSnap.exists
    ? (stateSnap.data() as CronState).last_judged_timestamp
    : Timestamp.fromDate(new Date(0));

  console.log(`[audience-favorite] Last judged: ${lastJudged.toDate().toISOString()}`);

  // 2. Query unjudged incidents (newer than last judged, ordered by timestamp)
  const incidentsSnap = await db
    .collection('incident_logs')
    .where('timestamp', '>', lastJudged)
    .orderBy('timestamp', 'asc')
    .get();

  const unjudged = incidentsSnap.docs;
  console.log(`[audience-favorite] Found ${unjudged.length} unjudged incident(s)`);

  if (unjudged.length < MIN_BATCH) {
    console.log(`[audience-favorite] < ${MIN_BATCH} unjudged — skipping, will retry next run.`);
    return;
  }

  // 3. Take exactly 5 most recent (last 5 in asc order)
  const batch = unjudged.slice(-MIN_BATCH);
  const candidates = batch.map((d) => {
    const data = d.data() as IncidentDoc;
    return {
      uid: data.uid,
      legacy_infra_class: data.legacy_infra_class,
      diagnosis: data.diagnosis,
      severity: data.severity,
      archive_note: data.archive_note,
      failure_origin: data.failure_origin,
      chromatic_profile: data.chromatic_profile,
      system_dx: data.system_dx,
      incident_feed_summary: data.incident_feed_summary,
      share_quote: data.share_quote,
    };
  });

  console.log('[audience-favorite] Candidates:', candidates.map((c) => c.uid));

  // 4. Send to Gemini
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const prompt = `${JUDGING_PROMPT}\n\n## Incidents\n\n${JSON.stringify(candidates, null, 2)}`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json' },
  });

  const responseText = response.text?.trim();
  if (!responseText) throw new Error('Gemini returned empty response');

  let result: JudgingResult;
  try {
    result = JSON.parse(responseText) as JudgingResult;
  } catch {
    throw new Error(`Failed to parse Gemini response: ${responseText}`);
  }

  if (!result.winner || !result.rationale) {
    throw new Error(`Invalid judging result: ${JSON.stringify(result)}`);
  }

  console.log(`[audience-favorite] Winner: ${result.winner}`);
  console.log(`[audience-favorite] Rationale: ${result.rationale}`);

  // 5. Find the winner's Firestore doc and award an escalation
  const winnerDoc = batch.find((d) => (d.data() as IncidentDoc).uid === result.winner);
  if (!winnerDoc) {
    throw new Error(`Winner UID "${result.winner}" not found in candidate batch`);
  }

  const firestoreBatch = db.batch();

  // Award escalation vote to winner
  firestoreBatch.update(winnerDoc.ref, {
    escalation_count: FieldValue.increment(1),
  });

  // Record the system vote in the escalations subcollection
  const systemEscalationRef = winnerDoc.ref.collection('escalations').doc('system_audience_favorite');
  firestoreBatch.set(systemEscalationRef, {
    uid: 'system_audience_favorite',
    timestamp: FieldValue.serverTimestamp(),
    rationale: result.rationale,
  });

  // Update cron state — advance to the newest candidate's timestamp
  // so all 5 candidates are marked as judged
  const newestTimestamp = (batch[batch.length - 1].data() as IncidentDoc).timestamp;
  firestoreBatch.set(stateRef, { last_judged_timestamp: newestTimestamp }, { merge: true });

  await firestoreBatch.commit();

  console.log(`[audience-favorite] Escalation awarded to ${result.winner}. State updated.`);
}

run().catch((err) => {
  console.error('[audience-favorite] Fatal error:', err);
  process.exit(1);
});
