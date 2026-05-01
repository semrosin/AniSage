import axios from 'axios';
import { AnimeSummary } from './types';

const BASE_URL = 'https://shikimori.one/api';
const MAX_FETCH_RETRIES = 3;
const FETCH_RETRY_DELAY_MS = 500;
const MAX_CONCURRENT_ENRICH = 5;

const animeCache = new Map<number, AnimeSummary>();

const EXCLUDED_GENRE_IDS = [
  9,   // Ecchi
  12,  // Hentai
  33,  // Yaoi
  34,  // Yuri
  26,  // Shoujo Ai
  28,  // Shounen Ai
  539, // Erotica
  51,  // Ecchi (manga)
  59,  // Hentai (manga)
  65,  // Yaoi (manga)
  75,  // Yuri (manga)
  73,  // Shoujo Ai (manga)
  55,  // Shounen Ai (manga)
  540, // Erotica (manga)
];

const ALLOWED_KINDS = [
  'tv',
  'movie',
  'ova',
  'ona',
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function axiosGetWithRetry<T>(url: string, params?: any): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_FETCH_RETRIES; attempt++) {
    try {
      const response = await axios.get<T>(url, { params });
      return response.data;
    } catch (error: unknown) {
      lastError = error;
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        const delay = FETCH_RETRY_DELAY_MS * (attempt + 1);
        console.warn(`Shikimori 429, retry after ${delay}ms`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function normalizeApiAnime(item: any): AnimeSummary {
  let image = item.image?.preview || item.image?.x96 || item.image?.x48 || item.image?.original || '';
  if (typeof image === 'string' && image.startsWith('/')) {
    image = `https://shikimori.one${image}`;
  }

  const genres = Array.isArray(item.genres)
    ? item.genres.map((g: any) => g.russian || g.name || '').filter(Boolean)
    : [];

  const studios = Array.isArray(item.studios)
    ? item.studios.map((s: any) => s.name).filter(Boolean)
    : [];

  return {
    id: item.id,
    title: item.russian || item.name || String(item.id),
    image,
    year: item.year || (item.released_on ? parseInt(item.released_on.substring(0, 4)) : undefined),
    genres,
    studios,
    score: item.score || 0,
    episodes: item.episodes || null,
    status: item.status || null,
    country: item.country || null,
    description: item.description || '',
  };
}

function getExcludedGenresParam(): string {
  return EXCLUDED_GENRE_IDS.map(id => `!${id}`).join(',');
}

function getKindsParam(): string {
  return ALLOWED_KINDS.join(',');
}

async function fetchAnimeList(params: Record<string, any>): Promise<AnimeSummary[]> {
  const finalParams = {
    ...params,
    genre: getExcludedGenresParam(),
    kind: getKindsParam(),
  };
  const data = await axiosGetWithRetry<any[]>(`${BASE_URL}/animes`, finalParams);
  if (!Array.isArray(data)) return [];
  return data.map(normalizeApiAnime);
}

export async function searchAnime(query: string, limit = 50): Promise<AnimeSummary[]> {
  return fetchAnimeList({
    search: query,
    limit: Math.min(limit, 50),
    order: 'popularity',
  });
}

export async function fetchPopularAnime(limit = 50): Promise<AnimeSummary[]> {
  return fetchAnimeList({
    order: 'popularity',
    limit: limit,
    page: 1,
  });
}

export async function fetchAnimeById(animeId: number): Promise<AnimeSummary> {
  if (animeCache.has(animeId)) {
    return animeCache.get(animeId)!;
  }

  const data = await axiosGetWithRetry<any>(`${BASE_URL}/animes/${animeId}`);
  const normalized = normalizeApiAnime(data);
  animeCache.set(animeId, normalized);
  return normalized;
}

function shouldEnrich(anime: AnimeSummary): boolean {
  return anime.genres.length === 0 || anime.studios.length === 0 || anime.year === null;
}

export async function enrichAnimeDetails(anime: AnimeSummary): Promise<AnimeSummary> {
  if (!shouldEnrich(anime)) return anime;
  try {
    return await fetchAnimeById(anime.id);
  } catch (error) {
    console.warn(`Failed to enrich anime ${anime.id}:`, error);
    return anime;
  }
}

async function mapWithConcurrency<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      try {
        results[currentIndex] = await fn(items[currentIndex]);
      } catch (error) {
        console.error(`Worker failed at index ${currentIndex}:`, error);
        results[currentIndex] = items[currentIndex] as unknown as R;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function enrichCandidates(candidates: AnimeSummary[], topN = 60): Promise<AnimeSummary[]> {
  const slice = candidates.slice(0, topN);
  return mapWithConcurrency(slice, enrichAnimeDetails, MAX_CONCURRENT_ENRICH);
}
