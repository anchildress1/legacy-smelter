/**
 * Shared Firebase Admin SDK initialization for server-side scripts.
 *
 * Credential resolution order:
 *   1. FIREBASE_SERVICE_ACCOUNT_JSON env var (inline JSON)
 *   2. GOOGLE_APPLICATION_CREDENTIALS env var (file path)
 *   3. Application Default Credentials (ADC)
 */

import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const DATABASE_ID = process.env.FIREBASE_FIRESTORE_DATABASE_ID;

if (!PROJECT_ID) throw new Error('Missing FIREBASE_PROJECT_ID');
if (!DATABASE_ID) throw new Error('Missing FIREBASE_FIRESTORE_DATABASE_ID');

function getServiceAccountCredential(): ServiceAccount | undefined {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try { return JSON.parse(json) as ServiceAccount; }
    catch (e) { throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${e}`); }
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    try { return JSON.parse(readFileSync(credPath, 'utf-8')) as ServiceAccount; }
    catch (e) { throw new Error(`Failed to read/parse GOOGLE_APPLICATION_CREDENTIALS at ${credPath}: ${e}`); }
  }

  return undefined;
}

const credential = getServiceAccountCredential();
initializeApp(credential ? { credential: cert(credential), projectId: PROJECT_ID } : { projectId: PROJECT_ID });

export const db = getFirestore(DATABASE_ID);
