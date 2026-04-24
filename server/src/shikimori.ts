import axios from 'axios';
import { AnimeSummary } from './types';

const BASE_URL = 'https://shikimori.one';
const MAX_FETCH_RETRIES = 3;
const FETCH_RETRY_DELAY_MS = 500;
const MAX_CONCURRENT_ENRICH = 5;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ShikimoriGenre = {
  id: number;
  name?: string;
  russian?: string;
  en?: string;
};

let allowedGenreIdsCache: number[] | null = null;

async function fetchShikimoriGenres(): Promise<ShikimoriGenre[]> {
  const data = await axiosGetWithRetry<any[]>(`${BASE_URL}/api/genres`);
  if (!Array.isArray(data)) {
    return [];
  }
  return data;
}

function getGenreNames(genre: ShikimoriGenre): string[] {
  return [genre.name, genre.russian, genre.en].filter(Boolean).map(String);
}

async function getAllowedGenreIds(): Promise<number[]> {
  if (allowedGenreIdsCache) {
    return allowedGenreIdsCache;
  }

  const genres = await fetchShikimoriGenres();
  allowedGenreIdsCache = genres
    .filter((genre) => !getGenreNames(genre).some(isEroticGenre))
    .map((genre) => genre.id);

  return allowedGenreIdsCache;
}

function isEroticGenre(genre: string) {
  const normalized = String(genre)
    .toLowerCase();

  return (
    normalized === 'ecchi' ||
    normalized === 'hentai' ||
    normalized === 'ero' ||
    normalized === 'adult' ||
    normalized === 'эротика' ||
    normalized === 'этти' ||
    normalized === 'хентай' ||
    normalized.includes('ecchi') ||
    normalized.includes('hentai') ||
    normalized.includes('ero') ||
    normalized.includes('adult')
  );
}

export function filterEroticAnime<T extends AnimeSummary>(animeList: T[]): T[] {
  return animeList.filter((anime) => !anime.genres.some(isEroticGenre));
}

async function axiosGetWithRetry<T>(url: string) {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_FETCH_RETRIES; attempt += 1) {
    try {
      const response = await axios.get<T>(url);
      return response.data;
    } catch (error: unknown) {
      lastError = error;

      if (axios.isAxiosError(error) && error.response?.status === 429) {
        const delay = FETCH_RETRY_DELAY_MS * (attempt + 1);
        console.warn(`Shikimori 429 for ${url}, retrying after ${delay}ms`);
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

function normalizeApiAnime(item: any): AnimeSummary {
  let image = item.image?.preview || item.image?.x96 || item.image?.x48 || item.image || '';
  if (typeof image === 'string' && image.startsWith('/')) {
    image = `${BASE_URL}${image}`;
  }

  const genres = Array.isArray(item.genres)
    ? item.genres
        .map((genre: any) => (typeof genre === 'string' ? genre : genre.name || genre.russian || genre.en || ''))
        .filter(Boolean)
    : [];

  const studios = Array.isArray(item.studios)
    ? item.studios.map((studio: any) => (typeof studio === 'string' ? studio : studio.name || '')).filter(Boolean)
    : [];

  return {
    id: item.id,
    title: item.russian || item.name || item.name_ru || item.name_en || String(item.id),
    image,
    year: item.year || null,
    genres,
    studios
  };
}

const animeCache = new Map<number, AnimeSummary>();

export async function fetchAnimeById(animeId: number): Promise<AnimeSummary> {
  const cached = animeCache.get(animeId);
  if (cached) {
    return cached;
  }

  const data = await axiosGetWithRetry<any>(`${BASE_URL}/api/animes/${animeId}`);
  const normalized = normalizeApiAnime(data);
  animeCache.set(animeId, normalized);
  return normalized;
}

function shouldEnrich(anime: AnimeSummary) {
  return anime.genres.length === 0 || anime.studios.length === 0 || anime.year === null;
}

export async function enrichAnimeDetails(anime: AnimeSummary): Promise<AnimeSummary> {
  if (!shouldEnrich(anime)) {
    return anime;
  }

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
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await fn(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function searchAnime(query: string, limit = 50): Promise<AnimeSummary[]> {
  const response = await axios.get(`${BASE_URL}/api/animes`, {
    params: {
      search: query,
      limit,
      order: 'popularity',
    }
  });

  if (!Array.isArray(response.data)) {
    return [];
  }

  return response.data.map(normalizeApiAnime);
}

export async function fetchPopularAnime(limit = 50): Promise<AnimeSummary[]> {
  const response = await axios.get(`${BASE_URL}/api/animes`, {
    params: {
      order: 'popularity',
      limit,
      page: 1,
    }
  });

  if (!Array.isArray(response.data)) {
    return [];
  }

  return response.data.map(normalizeApiAnime);
}

export async function enrichCandidates(candidates: AnimeSummary[], topN = 40): Promise<AnimeSummary[]> {
  const slice = candidates.slice(0, topN);
  return mapWithConcurrency(slice, enrichAnimeDetails, MAX_CONCURRENT_ENRICH);
}
