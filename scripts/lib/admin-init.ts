/**
 * Re-export of the shared admin-init for TypeScript scripts.
 * Actual initialization logic lives in shared/admin-init.js.
 */
import { getDb } from '../../shared/admin-init.js';

export const db = getDb();
