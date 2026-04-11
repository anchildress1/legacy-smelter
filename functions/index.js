/**
 * Cloud Functions v2 entry point for Legacy Smelter sanction judging.
 *
 * One Firestore `onDocumentCreated` trigger watches the named `legacy-smelter`
 * database's `incident_logs` collection. Every new incident write invokes
 * `runSanctionBatch`, which sweeps stale leases, tries to claim a batch of
 * five unevaluated incidents, asks Gemini to pick one winner, and commits the
 * result atomically. Fewer than five unclaimed → no-op. Any throw activates
 * Cloud Functions v2 event retry; the next invocation's sweep recovers the
 * stale claim after `LEASE_TTL_MS` (see `./sanction.js`).
 *
 * Why the logic lives in `./sanction.js` instead of this file:
 *   - Unit tests import the sanction module directly without loading
 *     `firebase-functions` (which requires a functions framework runtime).
 *   - This file stays a thin trigger declaration — a grep-able, reviewable
 *     surface that shows every Cloud Function this project deploys.
 */

import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { runSanctionBatch } from './sanction.js';

// Secret is defined at the top of the module so `firebase deploy` can see the
// binding in the manifest and wire GSM access at deploy time. The value is
// read at invocation time via `.value()` — reading it at import would be
// evaluated before the secret is bound and would always be empty.
const geminiApiKey = defineSecret('GEMINI_API_KEY');

// Named database this project uses. Must match the `database` field in
// `firebase.json` and the `FIRESTORE_DATABASE` constant in `sanction.js`.
const FIRESTORE_DATABASE = 'legacy-smelter';

// Region is pinned so all Cloud Functions land next to the existing Cloud Run
// service for latency. `maxInstances` caps fan-out: in the worst case every
// incident create fires this trigger, and we do not want a burst write to
// spin up hundreds of concurrent Gemini calls.
setGlobalOptions({
  region: 'us-east1',
  maxInstances: 10,
});

export const onIncidentCreated = onDocumentCreated(
  {
    document: 'incident_logs/{incidentId}',
    database: FIRESTORE_DATABASE,
    secrets: [geminiApiKey],
    // Cloud Functions v2 event retry is how the sweep-recovery pattern closes
    // the loop: a thrown error here is re-delivered, and the next invocation's
    // `sweepStaleLeases` call puts any stranded claim back in the unevaluated
    // pool after the lease TTL.
    retry: true,
  },
  async (event) => {
    const incidentId = event.params?.incidentId;
    if (!event.data) {
      logger.warn('[sanction-trigger] Empty event payload; skipping.', { incidentId });
      return;
    }

    logger.info('[sanction-trigger] Incident created; running sanction batch.', {
      incidentId,
    });

    try {
      const result = await runSanctionBatch({ geminiApiKey: geminiApiKey.value() });
      logger.info('[sanction-trigger] Sanction batch finished.', { incidentId, ...result });
    } catch (err) {
      // Rethrow to activate Cloud Functions v2 event retry. Do NOT swallow —
      // the retry is what keeps the sweep-recovery invariant working.
      logger.error('[sanction-trigger] Sanction batch failed; will retry.', {
        incidentId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
);
