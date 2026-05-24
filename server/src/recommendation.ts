import { UserMetrics, AnimeSummary, UserRating } from './types';

type FeatureVector = Record<string, number>;

const FEATURE_WEIGHTS = {
  genre: 1,
  studio: 1
};

const POPULARITY_WEIGHT = {
  minMultiplier: 0.65,
  maxMultiplier: 1.35,
  neutralScore: 7.0
};

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

function addVectorValue(vector: FeatureVector, key: string, value: number) {
  if (!Number.isFinite(value) || value === 0) return;
  vector[key] = (vector[key] || 0) + value;
}

function getUniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function addNormalizedGroupFeatures(
  vector: FeatureVector,
  prefix: 'genre' | 'studio',
  values: string[],
  weight: number
) {
  const uniqueValues = getUniqueValues(values);
  if (uniqueValues.length === 0) return;

  const featureValue = weight / Math.sqrt(uniqueValues.length);
  uniqueValues.forEach(value => {
    addVectorValue(vector, `${prefix}:${value}`, featureValue);
  });
}

export function buildAnimeVector(anime: Pick<AnimeSummary | UserRating, 'genres' | 'studios'>): FeatureVector {
  const vector: FeatureVector = {};
  addNormalizedGroupFeatures(vector, 'genre', anime.genres || [], FEATURE_WEIGHTS.genre);
  addNormalizedGroupFeatures(vector, 'studio', anime.studios || [], FEATURE_WEIGHTS.studio);
  return vector;
}

function buildUserVector(metrics: UserMetrics): FeatureVector {
  const vector: FeatureVector = {};
  Object.entries(metrics.genre_sums).forEach(([genre, weight]) => {
    addVectorValue(vector, `genre:${genre}`, weight);
  });
  Object.entries(metrics.studio_weights).forEach(([studio, weight]) => {
    addVectorValue(vector, `studio:${studio}`, weight);
  });
  return vector;
}

function cosineSimilarity(left: FeatureVector, right: FeatureVector): number {
  let dot = 0;
  let leftNormSq = 0;
  let rightNormSq = 0;

  Object.values(left).forEach(value => {
    leftNormSq += value * value;
  });

  Object.entries(right).forEach(([key, value]) => {
    dot += (left[key] || 0) * value;
    rightNormSq += value * value;
  });

  if (leftNormSq === 0 || rightNormSq === 0) return 0;
  return dot / (Math.sqrt(leftNormSq) * Math.sqrt(rightNormSq));
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
    if (rating.rating_normalized > 0) {
      metrics.positive_count += 1;
      metrics.total_score += rating.rating_normalized;
      if (rating.year) {
        metrics.year_weight_sum += rating.rating_normalized * rating.year;
        metrics.year_weight_sq_sum += rating.rating_normalized * rating.year * rating.year;
      }
    }

    getUniqueValues(rating.genres).forEach(genre => {
      metrics.genre_counts[genre] = (metrics.genre_counts[genre] || 0) + 1;
    });

    Object.entries(buildAnimeVector(rating)).forEach(([feature, value]) => {
      const weightedValue = rating.rating_normalized * value;
      if (feature.startsWith('genre:')) {
        const genre = feature.slice('genre:'.length);
        metrics.genre_sums[genre] = (metrics.genre_sums[genre] || 0) + weightedValue;
      }
      if (feature.startsWith('studio:')) {
        const studio = feature.slice('studio:'.length);
        metrics.studio_weights[studio] = (metrics.studio_weights[studio] || 0) + weightedValue;
      }
    });
  });

  return metrics;
}

export function computeGenreWeight(genre: string, metrics: UserMetrics): number {
  return metrics.genre_sums[genre] || 0;
}

export function computeYearCenter(metrics: UserMetrics) {
  const positiveSum = metrics.total_score;
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

export function computeYearScore(year: number | null | undefined, mu: number, sigma2: number): number {
  if (!year) return 0.85;
  return Math.exp(-Math.pow(year - mu, 2) / (2 * sigma2));
}

export function computeVectorSimilarity(candidate: AnimeSummary, metrics: UserMetrics): number {
  return cosineSimilarity(buildUserVector(metrics), buildAnimeVector(candidate));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computePopularityMultiplier(score: number | null | undefined): number {
  const normalizedScore = clamp(Number(score || 0), 0, 10);
  if (normalizedScore <= 0) return POPULARITY_WEIGHT.minMultiplier;

  const centeredScore = (normalizedScore - POPULARITY_WEIGHT.neutralScore) / (10 - POPULARITY_WEIGHT.neutralScore);
  const curvedScore = Math.sign(centeredScore) * Math.pow(Math.abs(centeredScore), 1.35);
  const range = POPULARITY_WEIGHT.maxMultiplier - POPULARITY_WEIGHT.minMultiplier;
  const midpoint = POPULARITY_WEIGHT.minMultiplier + range / 2;

  return clamp(
    midpoint + curvedScore * range / 2,
    POPULARITY_WEIGHT.minMultiplier,
    POPULARITY_WEIGHT.maxMultiplier
  );
}

export function computeStudioScore(
  candidate: AnimeSummary,
  metrics: UserMetrics,
  _similarityMatrix?: Record<string, Record<string, number>>
): number {
  const userStudioVector: FeatureVector = {};
  const candidateStudioVector: FeatureVector = {};
  Object.entries(metrics.studio_weights).forEach(([studio, weight]) => {
    addVectorValue(userStudioVector, `studio:${studio}`, weight);
  });
  addNormalizedGroupFeatures(candidateStudioVector, 'studio', candidate.studios || [], FEATURE_WEIGHTS.studio);
  return cosineSimilarity(userStudioVector, candidateStudioVector);
}

export function scoreAnime(
  candidate: AnimeSummary,
  metrics: UserMetrics,
  _similarityMatrix?: Record<string, Record<string, number>>
): number {
  const { mu, sigma2 } = computeYearCenter(metrics);
  const yearScore = computeYearScore(candidate.year, mu, sigma2);
  const similarityScore = computeVectorSimilarity(candidate, metrics);
  const popularityMultiplier = computePopularityMultiplier(candidate.score);
  return similarityScore * yearScore * popularityMultiplier;
}

function normalizeTitleForSeries(title: string): string {
  return title
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[“”"«»'`]/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeSeasonSuffix(title: string): string {
  let value = normalizeTitleForSeries(title);

  value = value
    .replace(/\s*[:\-–—]\s*\d+(?:st|nd|rd|th)?\s*(season|сезон|cour|курс).*/i, '')
    .replace(/\s*[:\-–—]\s*(season|сезон|cour|курс)\s*\d+.*$/i, '')
    .replace(/\s*[:\-–—]\s*(season|сезон)\s*\d+.*$/i, '')
    .replace(/\s*[:\-–—]\s*\d+\s*(season|сезон).*/i, '')
    .replace(/\s*[:\-–—]\s*(final|финал|финальный|последний).*(season|сезон|part|часть)?.*$/i, '')
    .replace(/\s*[:\-–—]\s*(part|часть)\s*\d+.*$/i, '')
    .replace(/\s*[:\-–—]\s*\d+$/i, '')
    .replace(/\s+(season|сезон)\s*\d+.*$/i, '')
    .replace(/\s+\d+\s*(season|сезон).*/i, '')
    .replace(/\s+(?:тв|tv)\s*\d+.*$/i, '')
    .replace(/\s+(part|часть)\s*\d+.*$/i, '')
    .replace(/\s+(?:part|часть|cour|курс)\s*\d+.*$/i, '')
    .replace(/\s+(i{2,3}|iv|v|vi{0,3}|ix|x)$/i, '')
    .replace(/\s+\d+$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return value || normalizeTitleForSeries(title);
}

function looksLikeContinuation(title: string): boolean {
  const value = normalizeTitleForSeries(title);
  return (
    /\s*[:\-–—]\s*\d+$/i.test(value) ||
    /\s+\d+$/i.test(value) ||
    /\s+(?:season|сезон|part|часть|cour|курс)\s*\d+/i.test(value) ||
    /\s+\d+\s*(?:season|сезон|part|часть|cour|курс)/i.test(value) ||
    /\s+(?:тв|tv)\s*\d+/i.test(value) ||
    /\s+(?:ii|iii|iv|v|vi{0,3}|ix|x)$/i.test(value)
  );
}

function getRecommendationSeriesKey(anime: Pick<AnimeSummary | UserRating, 'title'>) {
  return removeSeasonSuffix(anime.title);
}

export function buildRecommendations(
  candidates: AnimeSummary[],
  ratings: UserRating[],
  metrics: UserMetrics,
  similarityMatrix: Record<string, Record<string, number>>
) {
  const ratedIds = new Set(ratings.map(item => item.anime_id));
  const ratedSeriesKeys = new Set(ratings.map(getRecommendationSeriesKey));
  const recommendedSeriesKeys = new Set<string>();

  const scoredCandidates = candidates
    .filter(candidate => !ratedIds.has(candidate.id))
    .filter(candidate => !looksLikeContinuation(candidate.title))
    .map(candidate => ({
      anime: candidate,
      recommendationScore: scoreAnime(candidate, metrics, similarityMatrix)
    }))
    .sort((a, b) => b.recommendationScore - a.recommendationScore);

  const recommendations: Array<AnimeSummary & { recommendationScore: number }> = [];
  for (const item of scoredCandidates) {
    const seriesKey = getRecommendationSeriesKey(item.anime);
    if (ratedSeriesKeys.has(seriesKey) || recommendedSeriesKeys.has(seriesKey)) {
      continue;
    }

    recommendedSeriesKeys.add(seriesKey);
    recommendations.push({ ...item.anime, recommendationScore: item.recommendationScore });
    if (recommendations.length >= 24) break;
  }

  return recommendations;
}
