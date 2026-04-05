import type { Timestamp } from 'firebase/firestore';

export interface SmeltLog {
  id: string;
  timestamp: Timestamp | null;
  pixel_count: number;
  damage_report: string;
  dominant_colors: string[];
}

export interface GlobalStats {
  total_pixels_melted: number;
}
