export interface SmeltLog {
  id: string;
  timestamp: any;
  pixel_count: number;
  damage_report: string;
  dominant_colors: string[];
}

export interface GlobalStats {
  total_pixels_melted: number;
}
