/**
 * One-shot cleanup: deletes the legacy `system_dx` field from every
 * incident_logs document. The field has been removed from the schema,
 * server writes, parsers, sanction script, blueprint, and UI — this
 * script removes it from existing docs so the data matches the code.
 *
 * `system_dx` was a duplicate of `diagnosis` with a medical/clinical
 * framing that conflicted with the project's institutional voice.
 * `diagnosis` is now the single source of truth and is rendered in
 * the overlay's Diagnostics section.
 *
 * Idempotent. Re-running on a clean collection is a no-op (no doc
 * matches `system_dx != undefined` after the first pass).
 *
 * Run: npx tsx scripts/strip-system-dx-field.ts
 * Env: FIREBASE_PROJECT_ID, FIREBASE_FIRESTORE_DATABASE_ID,
 *      GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT_JSON)
 */

import 'dotenv/config';
import { db } from './lib/admin-init.js';
import { stripLegacyField } from './lib/stripLegacyField.js';

try {
  await stripLegacyField({
    db,
    fieldName: 'system_dx',
    logPrefix: 'strip-system-dx',
  });
} catch (err) {
  console.error('[strip-system-dx] Fatal:', err);
  process.exit(1);
}
