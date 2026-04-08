import { initializeApp } from 'firebase/app';
import { getFirestore, collection, onSnapshot, query, orderBy, limit, startAfter, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, increment, serverTimestamp, writeBatch, runTransaction, type QueryDocumentSnapshot, type DocumentData } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

// Validate environment variables
const requiredVars = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID'
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
export const db = getFirestore(app, import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || 'legacy-smelter');
const auth = getAuth(app);
let anonymousAuthPromise: Promise<void> | null = null;

export async function ensureAnonymousAuth(): Promise<void> {
  if (typeof window === 'undefined') return;
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
  startAfter,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  increment,
  serverTimestamp,
  writeBatch,
  runTransaction,
  type QueryDocumentSnapshot,
  type DocumentData,
};
