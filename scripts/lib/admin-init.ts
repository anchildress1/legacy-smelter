/**
 * Re-export of the shared admin-init for TypeScript scripts.
 * Actual initialization logic lives in shared/admin-init.js.
 */
// @ts-expect-error — plain JS module without types
import { getDb } from '../../shared/admin-init.js';

export const db = getDb();
