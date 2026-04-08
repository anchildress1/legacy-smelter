/**
 * AI sanction cron script.
 *
 * Every full batch of 5 unjudged incidents is sent to Gemini.
 * Gemini selects exactly one incident to receive a sanction.
 *
 * Run: npx tsx scripts/sanction-incidents.ts
 * Env: GEMINI_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_FIRESTORE_DATABASE_ID,
 *      GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT_JSON)
 */

import 'dotenv/config';
import { FieldValue } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { db } from './lib/admin-init';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MIN_BATCH = 5;
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const LOCK_COLLECTION = 'system_locks';
const LOCK_DOC_ID = 'sanction-incidents';
const LOCK_TTL_MS = 8 * 60 * 1000;
const RUN_ID = randomUUID();

if (!GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');

const __dirname = dirname(fileURLToPath(import.meta.url));
const JUDGING_PROMPT = readFileSync(resolve(__dirname, '../docs/judging-prompt.md'), 'utf-8');

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

interface Candidate {
  incident_id: string;
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

interface SanctionSelection {
  sanctioned_incident_id: string;
  sanction_rationale: string;
}

function getLockRef() {
  return db.collection(LOCK_COLLECTION).doc(LOCK_DOC_ID);
}

async function acquireRunLock(): Promise<boolean> {
  const lockRef = getLockRef();
  const now = Date.now();
  const lockExpiresAt = now + LOCK_TTL_MS;

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const expiresAt = typeof data.lock_expires_at_ms === 'number' ? data.lock_expires_at_ms : 0;

    if (expiresAt > now) return false;

    tx.set(lockRef, {
      run_id: RUN_ID,
      lock_expires_at_ms: lockExpiresAt,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

async function refreshRunLock(): Promise<void> {
  const lockRef = getLockRef();
  const now = Date.now();
  const lockExpiresAt = now + LOCK_TTL_MS;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    if (data.run_id !== RUN_ID) {
      throw new Error('Run lock lost to another process');
    }
    tx.set(lockRef, {
      lock_expires_at_ms: lockExpiresAt,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

async function releaseRunLock(): Promise<void> {
  const lockRef = getLockRef();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    if (data.run_id !== RUN_ID) return;

    tx.set(lockRef, {
      run_id: FieldValue.delete(),
      lock_expires_at_ms: 0,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

function sanitizeRationale(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 500);
}

function normalizeSelection(raw: unknown, candidates: Candidate[]): SanctionSelection {
  const candidateIds = new Set(candidates.map((c) => c.incident_id));
  const uidToIncidentId = new Map(candidates.map((c) => [c.uid, c.incident_id]));

  let selectedRaw: unknown;
  let rationaleRaw: unknown;

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    selectedRaw = obj.sanctioned_incident_id ?? obj.sanctioned_incident_uid ?? obj.sanctioned;
    rationaleRaw = obj.sanction_rationale ?? obj.rationale;
  }

  let selectedIncidentId = typeof selectedRaw === 'string' ? selectedRaw.trim() : '';
  if (selectedIncidentId && !candidateIds.has(selectedIncidentId)) {
    selectedIncidentId = uidToIncidentId.get(selectedIncidentId) ?? '';
  }

  if (!selectedIncidentId) {
    // Keep the job progressing on malformed model output.
    selectedIncidentId = candidates[0].incident_id;
    console.warn('[sanction-incidents] Model returned invalid selection, defaulting to oldest incident in batch');
  }

  let sanctionRationale = sanitizeRationale(rationaleRaw);
  if (!sanctionRationale) {
    sanctionRationale = 'Selected for strongest screenshot value and deadpan incident specificity.';
  }

  return {
    sanctioned_incident_id: selectedIncidentId,
    sanction_rationale: sanctionRationale,
  };
}

async function run(): Promise<void> {
  console.log('[sanction-incidents] Starting run...');
  const lockAcquired = await acquireRunLock();
  if (!lockAcquired) {
    console.log('[sanction-incidents] Another run is in progress; exiting.');
    return;
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  let processedBatches = 0;

  try {
    // Keep processing full groups of 5 so sanctions do not lag during bursts.
    while (true) {
      await refreshRunLock();

      const unjudgedSnap = await db
        .collection('incident_logs')
        .where('judged', '==', false)
        .orderBy('timestamp', 'asc')
        .limit(MIN_BATCH)
        .get();

      console.log(`[sanction-incidents] ${unjudgedSnap.size} unjudged incident(s) (limit ${MIN_BATCH})`);

      if (unjudgedSnap.size < MIN_BATCH) {
        if (processedBatches === 0) {
          console.log(`[sanction-incidents] < ${MIN_BATCH} unjudged — skipping, will retry next run.`);
        } else {
          console.log(`[sanction-incidents] Completed ${processedBatches} batch(es); waiting for the next 5 incidents.`);
        }
        return;
      }

      const batch = unjudgedSnap.docs;
      const candidates: Candidate[] = batch.map((d) => {
        const data = d.data() as IncidentDoc;
        return {
          incident_id: d.id,
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

      console.log('[sanction-incidents] Candidates:', candidates.map((c) => c.incident_id));

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
      } catch (parseErr) {
        throw new Error(`Failed to parse Gemini response (${parseErr instanceof Error ? parseErr.message : parseErr}): ${responseText.slice(0, 200)}`);
      }

      const selection = normalizeSelection(parsed, candidates);
      console.log(`[sanction-incidents] Sanctioned incident: ${selection.sanctioned_incident_id}`);
      console.log(`[sanction-incidents] Rationale: ${selection.sanction_rationale}`);

      const writeBatch = db.batch();

      for (const d of batch) {
        const isSanctioned = d.id === selection.sanctioned_incident_id;
        writeBatch.update(d.ref, {
          judged: true,
          sanctioned: isSanctioned,
          sanction_count: isSanctioned ? 1 : 0,
          sanction_rationale: isSanctioned ? selection.sanction_rationale : FieldValue.delete(),
        });
      }

      await writeBatch.commit();
      processedBatches += 1;
      await refreshRunLock();

      console.log(`[sanction-incidents] Batch ${processedBatches} committed.`);
    }
  } finally {
    try {
      await releaseRunLock();
    } catch (releaseErr) {
      console.warn('[sanction-incidents] Failed to release run lock:', releaseErr);
    }
  }
}

run().catch((err) => {
  console.error('[sanction-incidents] Fatal error:', err);
  process.exit(1);
});
