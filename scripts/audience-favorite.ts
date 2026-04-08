/**
 * Audience Favorite cron script.
 *
 * Queries incidents where judged == false. When 5+ exist, takes the
 * oldest 5, sends them to Gemini for scoring, marks all 5 as judged,
 * and awards the winner an escalation vote + audience_favorite flag.
 *
 * Run: npx tsx scripts/audience-favorite.ts
 * Env: GEMINI_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_FIRESTORE_DATABASE_ID,
 *       GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT_JSON)
 */

import 'dotenv/config';
import { FieldValue } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './lib/admin-init';

// ── Config ──────────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
const MIN_BATCH = 5;
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

if (!GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');

// ── Load judging prompt from docs ───────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const JUDGING_PROMPT = readFileSync(resolve(__dirname, '../docs/judging-prompt.md'), 'utf-8');

// ── Types ───────────────────────────────────────────────────────────────

// Intentionally a standalone subset of SmeltLog (src/types.ts) rather than
// a Pick<SmeltLog,...>. The client SDK's Timestamp type is incompatible with
// the Admin SDK's Timestamp, so sharing the interface would introduce a
// transitive client-SDK dependency into this server-side script.
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
}

interface JudgingResult {
  winner: string;
  rationale: string;
}

// ── Main ────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log('[audience-favorite] Starting run...');

  // 1. Query unjudged incidents, oldest first
  const unjudgedSnap = await db
    .collection('incident_logs')
    .where('judged', '==', false)
    .orderBy('timestamp', 'asc')
    .limit(MIN_BATCH)
    .get();

  console.log(`[audience-favorite] ${unjudgedSnap.size} unjudged incident(s) (limit ${MIN_BATCH})`);

  if (unjudgedSnap.size < MIN_BATCH) {
    console.log(`[audience-favorite] < ${MIN_BATCH} unjudged — skipping, will retry next run.`);
    return;
  }

  // 2. Take oldest 5 (FIFO — no incident gets starved)
  const batch = unjudgedSnap.docs;
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

  // 3. Send to Gemini
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const prompt = `${JUDGING_PROMPT}\n\n## Incidents\n\n${JSON.stringify(candidates, null, 2)}`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json' },
  });

  const responseText = response.text?.trim();
  if (!responseText) throw new Error('Gemini returned empty response');

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error(`Failed to parse Gemini response: ${responseText}`);
  }

  const result = parsed as JudgingResult;
  if (typeof result.winner !== 'string' || typeof result.rationale !== 'string' ||
      result.winner.length === 0 || result.rationale.length === 0) {
    throw new Error(`Invalid judging result (expected {winner: string, rationale: string}): ${JSON.stringify(result)}`);
  }

  // Trim whitespace from LLM output and bound rationale length
  result.winner = result.winner.trim();
  result.rationale = result.rationale.trim().slice(0, 500);

  console.log(`[audience-favorite] Winner: ${result.winner}`);
  console.log(`[audience-favorite] Rationale: ${result.rationale}`);

  // 4. Find the winner doc
  const winnerDoc = batch.find((d) => (d.data() as IncidentDoc).uid === result.winner);
  if (!winnerDoc) {
    throw new Error(`Winner UID "${result.winner}" not found in candidate batch`);
  }

  // 5. Atomic batch: mark all 5 judged, award the winner
  const writeBatch = db.batch();

  for (const d of batch) {
    if (d.id === winnerDoc.id) {
      writeBatch.update(d.ref, {
        judged: true,
        audience_favorite: true,
        audience_favorite_rationale: result.rationale,
        escalation_count: FieldValue.increment(1),
      });
    } else {
      writeBatch.update(d.ref, { judged: true });
    }
  }

  // Record the system vote in the winner's escalations subcollection
  const systemEscalationRef = winnerDoc.ref.collection('escalations').doc('system_audience_favorite');
  writeBatch.set(systemEscalationRef, {
    uid: 'system_audience_favorite',
    timestamp: FieldValue.serverTimestamp(),
    rationale: result.rationale,
  });

  await writeBatch.commit();

  console.log(`[audience-favorite] All 5 marked judged. Winner: ${result.winner}`);
}

run().catch((err) => {
  console.error('[audience-favorite] Fatal error:', err);
  process.exit(1);
});
