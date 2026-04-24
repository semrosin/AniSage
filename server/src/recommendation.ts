import { UserMetrics, AnimeSummary, UserRating } from './types';

export function normalizeRating(value: number): number {
  if (value < 1 || value > 10) {
    throw new Error('Rating must be between 1 and 10');
  }
  if (value === 5) return 0;
  if (value < 5) {
    return value - 6;
  }
  return value - 5;
}

export function buildMetricsFromRatings(ratings: UserRating[]): UserMetrics {
  const metrics: UserMetrics = {
    user_id: ratings[0]?.user_id ?? 0,
    rating_count: ratings.length,
    positive_count: 0,
    total_score: 0,
    year_weight_sum: 0,
    year_weight_sq_sum: 0,
    genre_sums: {},
    genre_counts: {},
    studio_weights: {}
  };

  ratings.forEach(rating => {
    metrics.total_score += rating.rating_normalized;
    if (rating.rating_normalized > 0) {
      metrics.positive_count += 1;
      if (rating.year) {
        metrics.year_weight_sum += rating.rating_normalized * rating.year;
        metrics.year_weight_sq_sum += rating.rating_normalized * rating.year * rating.year;
      }
    }

    rating.genres.forEach(genre => {
      metrics.genre_sums[genre] = (metrics.genre_sums[genre] || 0) + rating.rating_normalized;
      metrics.genre_counts[genre] = (metrics.genre_counts[genre] || 0) + 1;
    });

    const studioWeight = rating.studios.length ? 1 / rating.studios.length : 0;
    rating.studios.forEach(studio => {
      metrics.studio_weights[studio] = (metrics.studio_weights[studio] || 0) + rating.rating_normalized * studioWeight;
    });
  });

  return metrics;
}

export function computeGenreWeight(genre: string, metrics: UserMetrics): number {
  const total = metrics.genre_sums[genre] || 0;
  const count = metrics.genre_counts[genre] || 0;
  return Math.log2(count + 1) * total;
}

export function computeYearCenter(metrics: UserMetrics) {
  const positiveSum = metrics.positive_count;
  const priorVariance = 16;
  const scalingM = 5;
  if (positiveSum === 0 || metrics.year_weight_sum === 0) {
    return {
      mu: 2020,
      sigma2: priorVariance
    };
  }
  const mu = metrics.year_weight_sum / positiveSum;
  const userVar = metrics.year_weight_sq_sum / positiveSum - mu * mu;
  const sigma2 = (positiveSum * Math.max(userVar, 0.1) + scalingM * priorVariance) / (positiveSum + scalingM);
  return { mu, sigma2 };
}

export function computeYearScore(year: number | undefined, mu: number, sigma2: number): number {
  if (!year) return 0.85;
  return Math.exp(-Math.pow(year - mu, 2) / (2 * sigma2));
}

export function computeStudioScore(candidate: AnimeSummary, metrics: UserMetrics, similarityMatrix: Record<string, Record<string, number>>): number {
  if (!candidate.studios.length || Object.keys(metrics.studio_weights).length === 0) {
    return 0;
  }

  return candidate.studios.reduce((acc, candidateStudio) => {
    const userStudioScores = Object.entries(metrics.studio_weights);
    const studioSim = similarityMatrix[candidateStudio] || {};
    const studioScore = userStudioScores.reduce((sum, [userStudio, weight]) => {
      const similarity = studioSim[userStudio] ?? 0.05;
      return sum + weight * similarity;
    }, 0);
    return acc + studioScore;
  }, 0) / Math.max(candidate.studios.length, 1);
}

export function scoreAnime(candidate: AnimeSummary, metrics: UserMetrics, similarityMatrix: Record<string, Record<string, number>>): number {
  const { mu, sigma2 } = computeYearCenter(metrics);
  const yearScore = computeYearScore(candidate.year, mu, sigma2);
  const genreScore = candidate.genres.reduce((sum, genre) => sum + computeGenreWeight(genre, metrics), 0);
  const studioScore = computeStudioScore(candidate, metrics, similarityMatrix);
  const beta = 0.55;
  return genreScore * yearScore + beta * studioScore;
}

export function buildRecommendations(
  candidates: AnimeSummary[],
  ratings: UserRating[],
  metrics: UserMetrics,
  similarityMatrix: Record<string, Record<string, number>>
) {
  const ratedIds = new Set(ratings.map(item => item.anime_id));
  return candidates
    .filter(candidate => !ratedIds.has(candidate.id))
    .map(candidate => ({
      anime: candidate,
      score: scoreAnime(candidate, metrics, similarityMatrix)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(item => ({ ...item.anime, score: item.score }));
}
