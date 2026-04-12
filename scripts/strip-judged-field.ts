/**
 * One-shot cleanup: deletes the legacy `judged` field from every
 * incident_logs document. The field has been removed from the schema,
 * server writes, sanction script, and rules — this script removes it
 * from existing docs so the data matches the code.
 *
 * Idempotent. Re-running on a clean collection is a no-op (no doc
 * matches `judged != undefined` after the first pass).
 *
 * Run: npx tsx scripts/strip-judged-field.ts
 * Env: FIREBASE_PROJECT_ID, FIREBASE_FIRESTORE_DATABASE_ID,
 *      GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT_JSON)
 */

import 'dotenv/config';
import { db } from './lib/admin-init.js';
import { stripLegacyField } from './lib/stripLegacyField.js';

try {
  await stripLegacyField({
    db,
    fieldName: 'judged',
    logPrefix: 'strip-judged',
  });
} catch (err) {
  console.error('[strip-judged] Fatal:', err);
  process.exit(1);
}
