import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import {
  getAuth,
  connectAuthEmulator,
  inMemoryPersistence,
  setPersistence,
  signInAnonymously,
  signOut,
} from 'firebase/auth';

const requiredVars = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_FIRESTORE_DATABASE_ID',
  'VITE_APP_URL',
] as const;

const missingVars = requiredVars.filter(v => !import.meta.env[v]);
if (missingVars.length > 0) {
  throw new Error(`Missing required Firebase environment variables: ${missingVars.join(', ')}`);
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID);
const auth = getAuth(app);

// Local emulator wiring. Opt-in via `VITE_USE_FIREBASE_EMULATOR=true` in
// `.env.local` so developer setups can freely toggle between the local
// emulator (fires the local `functions` trigger, keeps prod untouched)
// and production (reproduces the real trigger latency). Ports must match
// the `emulators` block in `firebase.json` — firestore:9180, auth:9099.
// The connect calls must run before any read/write, hence the top-of-file
// placement right after `getFirestore`/`getAuth`.
if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true') {
  const host = import.meta.env.VITE_FIREBASE_EMULATOR_HOST ?? '127.0.0.1';
  connectFirestoreEmulator(db, host, 9180);
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  // Switch to in-memory persistence and purge any cached user from an
  // earlier production session. Without this, the Firebase Auth SDK
  // restores the cached prod ID token from IndexedDB on page load and
  // refreshes it against the emulator — which then logs "Received a
  // signed JWT. Auth Emulator does not validate JWTs and IS NOT SECURE"
  // for every refresh. In-memory persistence guarantees each emulator
  // session starts with no user and mints fresh, unsigned tokens.
  setPersistence(auth, inMemoryPersistence)
    .then(() => signOut(auth))
    .catch((err) => {
      console.warn('[firebase] Failed to reset auth persistence for emulator:', err);
    });
  // Loud log so it is obvious in the browser console which backend the
  // app is talking to — a silent fallback is how "why is nothing in the
  // emulator log" happens in the first place.
  console.info(`[firebase] Connected to local emulators at ${host} (firestore:9180, auth:9099)`);
}

let anonymousAuthPromise: Promise<void> | null = null;

export async function ensureAnonymousAuth(): Promise<void> {
  if (globalThis.window === undefined) return;
  if (auth.currentUser) return;
  if (!anonymousAuthPromise) {
    anonymousAuthPromise = signInAnonymously(auth).then(() => undefined).catch((err) => {
      anonymousAuthPromise = null;
      throw err;
    });
  }
  await anonymousAuthPromise;
}

export {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  doc,
  getDoc,
  updateDoc,
  increment,
  serverTimestamp,
  runTransaction,
} from 'firebase/firestore';
