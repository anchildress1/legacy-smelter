import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';

/**
 * Returns a lazily-initialized Firestore admin client.
 * @throws if FIREBASE_PROJECT_ID or FIREBASE_FIRESTORE_DATABASE_ID is unset,
 *         or if credentials cannot be resolved.
 */
export declare function getDb(): Firestore;

/**
 * Returns the lazily-initialized firebase-admin Auth client.
 * @throws if FIREBASE_PROJECT_ID is unset or credentials cannot be resolved.
 */
export declare function getAdminAuth(): Auth;
