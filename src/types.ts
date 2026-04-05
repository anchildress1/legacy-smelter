import type { Timestamp } from 'firebase/firestore';

export interface SmeltLog {
  id: string;
  timestamp: Timestamp | null;
  pixel_count: number;
  damage_report: string;
  dominant_colors: string[];
  legacy_infra_class: string;
  cursed_dx: string;
  smelt_rating: string;
  palette_name: string;
  og_headline: string;
  og_description: string;
  share_quote: string;
}

export interface GlobalStats {
  total_pixels_melted: number;
}
