/**
 * Shared Firebase Admin SDK initialization for server-side code.
 *
 * Lazy — call `getDb()` after env vars are loaded (e.g. after `dotenv/config`).
 *
 * Credential resolution order:
 *   1. FIREBASE_SERVICE_ACCOUNT_JSON env var (inline JSON)
 *   2. GOOGLE_APPLICATION_CREDENTIALS env var (file path)
 *   3. Application Default Credentials (ADC)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';

function getServiceAccountCredential() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try { return JSON.parse(json); }
    catch (cause) { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON', { cause }); }
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    try { return JSON.parse(readFileSync(credPath, 'utf-8')); }
    catch (cause) { throw new Error(`Failed to read/parse GOOGLE_APPLICATION_CREDENTIALS at ${credPath}`, { cause }); }
  }

  return undefined;
}

function ensureApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Missing FIREBASE_PROJECT_ID');

  if (getApps().length === 0) {
    const credential = getServiceAccountCredential();
    initializeApp(credential ? { credential: cert(credential), projectId } : { projectId });
    // The firebase-admin SDK auto-routes to the emulator when this env
    // var is set, but that routing is silent — in local dev it is easy
    // to believe the server is writing to the emulator when it is
    // actually writing to production. Log the destination loud and
    // clear at init so a mis-set env var surfaces on the first boot.
    const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
    if (emulatorHost) {
      console.info(`[admin-init] Firestore → EMULATOR at ${emulatorHost} (project=${projectId})`);
    } else {
      console.info(`[admin-init] Firestore → PRODUCTION (project=${projectId})`);
    }
  }
  return projectId;
}

let _db = null;

export function getDb() {
  if (_db) return _db;
  ensureApp();
  const databaseId = process.env.FIREBASE_FIRESTORE_DATABASE_ID;
  if (!databaseId) throw new Error('Missing FIREBASE_FIRESTORE_DATABASE_ID');
  _db = getFirestore(databaseId);
  return _db;
}

let _auth = null;

export function getAdminAuth() {
  if (_auth) return _auth;
  ensureApp();
  _auth = getAuth();
  return _auth;
}
