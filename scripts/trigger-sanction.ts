#!/usr/bin/env npx tsx
/**
 * Manually invoke `runSanctionBatch` without waiting for a Firestore
 * `onDocumentCreated` trigger. Useful for iterating on the judging prompt
 * locally: run `make reset-sanctions`, then `make trigger-sanction`.
 *
 * Initializes Firebase Admin credentials via shared/admin-init (reads
 * FIREBASE_PROJECT_ID + optional service account from .env), then calls
 * runSanctionBatch the same way the Cloud Function trigger does — with only
 * geminiApiKey. The sanction module's own getDb() picks up the hardcoded
 * 'legacy-smelter' database from the already-initialized Admin app.
 *
 * Usage:
 *   make trigger-sanction
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:9180 make trigger-sanction
 */
import 'dotenv/config';
// The @google/genai SDK warns and defers to GOOGLE_API_KEY when both
// GOOGLE_API_KEY and GEMINI_API_KEY are present in the environment.
// This project uses GEMINI_API_KEY exclusively; scrub the duplicate so
// the SDK does not log a spurious warning or shadow the intended key.
delete process.env.GOOGLE_API_KEY;
import { ensureApp } from '../shared/admin-init.js';
import { runSanctionBatch } from '../functions/sanction.js';

const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
  console.error('Missing GEMINI_API_KEY in environment / .env');
  process.exit(1);
}

// Initialize credentials so the sanction module's internal getDb() call can
// reach Firestore (or the emulator) without needing FIREBASE_FIRESTORE_DATABASE_ID.
ensureApp();

console.log('[trigger-sanction] Invoking runSanctionBatch...');
const result = await runSanctionBatch({ geminiApiKey });
console.log('[trigger-sanction] Done:', JSON.stringify(result, null, 2));
