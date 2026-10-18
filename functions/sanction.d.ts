import type { GoogleGenAI } from '@google/genai';
import type { Firestore } from 'firebase-admin/firestore';

export interface SanctionBatchOptions {
  geminiApiKey?: string;
  aiClient?: GoogleGenAI;
  db?: Firestore;
  now?: number;
}

export type SanctionBatchResult =
  | { status: 'no-op' }
  | {
      status: 'completed';
      winnerId: string | null;
      impactScore: number | null;
      path: 'winner' | 'no-winner';
    };

export function runSanctionBatch(options?: SanctionBatchOptions): Promise<SanctionBatchResult>;
