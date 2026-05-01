export interface User {
  id: number;
  yandex_id: string;
  login: string;
  display_name: string;
  email?: string;
  picture?: string;
}

export interface UserRating {
  id?: number;
  user_id: number;
  anime_id: number;
  title: string;
  image?: string;
  year?: number | null;
  studios: string[];
  genres: string[];
  raw_rating: number;
  rating_normalized: number;
  updated_at?: string;
}

export interface UserMetrics {
  user_id: number;
  rating_count: number;
  positive_count: number;
  total_score: number;
  year_weight_sum: number;
  year_weight_sq_sum: number;
  genre_sums: Record<string, number>;
  genre_counts: Record<string, number>;
  studio_weights: Record<string, number>;
}

export interface AnimeSummary {
  id: number;
  title: string;
  image?: string;
  year?: number;
  genres: string[];
  studios: string[];
  score?: number;
  episodes?: number | null;
  status?: string | null;
  country?: string | null;
  description?: string;
}
