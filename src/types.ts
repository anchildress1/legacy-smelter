import type { Timestamp } from 'firebase/firestore';

export interface SmeltLog {
  id: string;
  pixel_count: number;
  damage_report: string;
  color_1: string;
  color_2: string;
  color_3: string;
  color_4: string;
  color_5: string;
  subject_box_ymin: number;
  subject_box_xmin: number;
  subject_box_ymax: number;
  subject_box_xmax: number;
  legacy_infra_class: string;
  legacy_infra_description: string;
  visual_summary: string;
  confidence: number;
  palette_name: string;
  cursed_dx: string;
  smelt_rating: string;
  dominant_contamination: string;
  secondary_contamination: string;
  root_cause: string;
  salvageability: string;
  museum_caption: string;
  og_headline: string;
  og_description: string;
  share_quote: string;
  anon_handle: string;
  timestamp: Timestamp | null;
  uid: string;
}

export interface GlobalStats {
  total_pixels_melted: number;
}
