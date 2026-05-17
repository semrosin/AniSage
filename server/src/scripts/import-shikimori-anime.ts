import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import initSqlJs, { Database } from 'sql.js';
import path from 'path';

const BASE_URL = 'https://shikimori.one/api';
const USER_AGENT = 'AniSage/1.0 (https://anisage.ru)';
const DEFAULT_PAGE_LIMIT = 50;
const DEFAULT_REQUEST_DELAY_MS = 1700;
const DEFAULT_DETAILS_CONCURRENCY = 1;
const DEFAULT_IMAGE_CONCURRENCY = 3;
const MAX_FETCH_RETRIES = 5;

const EXCLUDED_GENRE_IDS = [
  9, 12, 33, 34, 26, 28, 539, 51, 59, 65, 75, 73, 55, 540,
];

const ALLOWED_KINDS = ['tv', 'movie', 'ova', 'ona'];

type SqlValue = string | number | null;

type ImageInfo = {
  url: string;
  originalUrl: string;
  previewUrl: string;
  x96Url: string;
  x48Url: string;
  localPath: string | null;
  localUrl: string | null;
  contentType: string | null;
  sizeBytes: number | null;
};

type ImportOptions = {
  dbPath: string;
  imagesDir: string;
  pageLimit: number;
  requestDelayMs: number;
  detailsConcurrency: number;
  imageConcurrency: number;
  maxPages?: number;
  skipImages: boolean;
};

function parseArgs(argv: string[]): ImportOptions {
  const serverRoot = process.cwd();
  const options: ImportOptions = {
    dbPath: path.resolve(serverRoot, 'server.db'),
    imagesDir: path.resolve(serverRoot, 'uploads', 'images'),
    pageLimit: DEFAULT_PAGE_LIMIT,
    requestDelayMs: DEFAULT_REQUEST_DELAY_MS,
    detailsConcurrency: DEFAULT_DETAILS_CONCURRENCY,
    imageConcurrency: DEFAULT_IMAGE_CONCURRENCY,
    skipImages: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--db' && next) {
      options.dbPath = path.resolve(next);
      index++;
    } else if (arg === '--images-dir' && next) {
      options.imagesDir = path.resolve(next);
      index++;
    } else if (arg === '--limit' && next) {
      options.pageLimit = Math.min(Number(next), DEFAULT_PAGE_LIMIT);
      index++;
    } else if (arg === '--delay-ms' && next) {
      options.requestDelayMs = Number(next);
      index++;
    } else if (arg === '--details-concurrency' && next) {
      options.detailsConcurrency = Number(next);
      index++;
    } else if (arg === '--image-concurrency' && next) {
      options.imageConcurrency = Number(next);
      index++;
    } else if (arg === '--max-pages' && next) {
      options.maxPages = Number(next);
      index++;
    } else if (arg === '--skip-images') {
      options.skipImages = true;
    }
  }

  if (!Number.isFinite(options.pageLimit) || options.pageLimit < 1) {
    throw new Error('--limit must be a positive number');
  }
  if (!Number.isFinite(options.requestDelayMs) || options.requestDelayMs < 0) {
    throw new Error('--delay-ms must be a non-negative number');
  }
  if (!Number.isFinite(options.detailsConcurrency) || options.detailsConcurrency < 1) {
    throw new Error('--details-concurrency must be a positive number');
  }
  if (!Number.isFinite(options.imageConcurrency) || options.imageConcurrency < 1) {
    throw new Error('--image-concurrency must be a positive number');
  }
  if (options.maxPages !== undefined && (!Number.isFinite(options.maxPages) || options.maxPages < 1)) {
    throw new Error('--max-pages must be a positive number');
  }

  return options;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureBackup(dbPath: string) {
  if (!fs.existsSync(dbPath)) {
    return null;
  }

  const backupPath = `${dbPath}.backup-${timestampForFile()}`;
  fs.copyFileSync(dbPath, backupPath, fs.constants.COPYFILE_EXCL);
  return backupPath;
}

function saveDb(db: Database, dbPath: string) {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function getExcludedGenresParam() {
  return EXCLUDED_GENRE_IDS.map((id) => `!${id}`).join(',');
}

function getKindsParam() {
  return ALLOWED_KINDS.join(',');
}

function resolveShikimoriUrl(url?: string | null) {
  if (!url) return '';
  return url.startsWith('/') ? `https://shikimori.one${url}` : url;
}

function isMissingShikimoriImageUrl(url: string) {
  return /\/assets\/globals\/missing_[^/.]+\./i.test(url);
}

function getImageFileName(url: string) {
  return `${crypto.createHash('md5').update(url).digest('hex')}.jpg`;
}

async function axiosGetWithRetry<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_FETCH_RETRIES; attempt++) {
    try {
      const response = await axios.get<T>(url, {
        params,
        headers: { 'User-Agent': USER_AGENT },
        timeout: 30000,
      });
      return response.data;
    } catch (error: unknown) {
      lastError = error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const retryAfterHeader = axios.isAxiosError(error) ? error.response?.headers?.['retry-after'] : undefined;
      const retryAfter = Number(Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader);
      const delay = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : DEFAULT_REQUEST_DELAY_MS * (attempt + 2);

      if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || !status) {
        console.warn(`Request retry ${attempt + 1}/${MAX_FETCH_RETRIES}: ${url} after ${delay}ms`);
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function createSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS shikimori_anime (
      id INTEGER PRIMARY KEY,
      name TEXT,
      russian TEXT,
      title TEXT,
      kind TEXT,
      score REAL,
      status TEXT,
      episodes INTEGER,
      episodes_aired INTEGER,
      aired_on TEXT,
      released_on TEXT,
      year INTEGER,
      rating TEXT,
      english TEXT,
      synonyms TEXT,
      license_name_ru TEXT,
      description TEXT,
      description_html TEXT,
      image_url TEXT,
      image_original_url TEXT,
      image_preview_url TEXT,
      image_x96_url TEXT,
      image_x48_url TEXT,
      image_local_path TEXT,
      image_local_url TEXT,
      image_content_type TEXT,
      image_size_bytes INTEGER,
      genres TEXT NOT NULL DEFAULT '[]',
      genre_ids TEXT NOT NULL DEFAULT '[]',
      studios TEXT NOT NULL DEFAULT '[]',
      studio_ids TEXT NOT NULL DEFAULT '[]',
      country TEXT,
      raw_json TEXT,
      imported_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shikimori_import_runs (
      id INTEGER PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      total_seen INTEGER DEFAULT 0,
      total_imported INTEGER DEFAULT 0,
      total_images INTEGER DEFAULT 0,
      total_image_bytes INTEGER DEFAULT 0,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_shikimori_anime_title ON shikimori_anime(title);
    CREATE INDEX IF NOT EXISTS idx_shikimori_anime_russian ON shikimori_anime(russian);
    CREATE INDEX IF NOT EXISTS idx_shikimori_anime_name ON shikimori_anime(name);
    CREATE INDEX IF NOT EXISTS idx_shikimori_anime_score ON shikimori_anime(score);
    CREATE INDEX IF NOT EXISTS idx_shikimori_anime_year ON shikimori_anime(year);
  `);
}

function getRunId(db: Database) {
  const row = db.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0];
  return Number(row?.[0]);
}

function startRun(db: Database) {
  db.prepare(
    `INSERT INTO shikimori_import_runs (started_at, status)
     VALUES (?, 'running')`
  ).run([new Date().toISOString()]);
  return getRunId(db);
}

function finishRun(
  db: Database,
  runId: number,
  status: 'finished' | 'failed',
  stats: { totalSeen: number; totalImported: number; totalImages: number; totalImageBytes: number },
  error?: unknown
) {
  db.prepare(
    `UPDATE shikimori_import_runs
     SET finished_at = ?, status = ?, total_seen = ?, total_imported = ?,
       total_images = ?, total_image_bytes = ?, error = ?
     WHERE id = ?`
  ).run([
    new Date().toISOString(),
    status,
    stats.totalSeen,
    stats.totalImported,
    stats.totalImages,
    stats.totalImageBytes,
    error instanceof Error ? error.stack || error.message : error ? String(error) : null,
    runId,
  ]);
}

function queryExistingImage(db: Database, animeId: number): Pick<ImageInfo, 'localPath' | 'localUrl' | 'contentType' | 'sizeBytes'> {
  const stmt = db.prepare(
    `SELECT image_local_path, image_local_url, image_content_type, image_size_bytes
     FROM shikimori_anime
     WHERE id = ?`
  );
  stmt.bind([animeId]);
  const row = stmt.step() ? stmt.getAsObject() : undefined;
  stmt.free();

  return {
    localPath: typeof row?.image_local_path === 'string' ? row.image_local_path : null,
    localUrl: typeof row?.image_local_url === 'string' ? row.image_local_url : null,
    contentType: typeof row?.image_content_type === 'string' ? row.image_content_type : null,
    sizeBytes: typeof row?.image_size_bytes === 'number' ? row.image_size_bytes : null,
  };
}

function extractYear(item: any) {
  if (item.year) return Number(item.year);
  if (typeof item.aired_on === 'string' && item.aired_on.length >= 4) {
    const year = Number(item.aired_on.slice(0, 4));
    return Number.isFinite(year) ? year : null;
  }
  return null;
}

function extractImageUrls(item: any): Omit<ImageInfo, 'localPath' | 'localUrl' | 'contentType' | 'sizeBytes'> {
  const previewUrl = resolveShikimoriUrl(item.image?.preview);
  const x96Url = resolveShikimoriUrl(item.image?.x96);
  const x48Url = resolveShikimoriUrl(item.image?.x48);
  const originalUrl = resolveShikimoriUrl(item.image?.original);
  const usableUrls = [previewUrl, x96Url, x48Url, originalUrl].filter(url => url && !isMissingShikimoriImageUrl(url));

  return {
    url: usableUrls[0] || '',
    originalUrl,
    previewUrl,
    x96Url,
    x48Url,
  };
}

function normalizeNames(items: any[], key: 'name' | 'russian' = 'name') {
  if (!Array.isArray(items)) return [];
  return items.map((item) => item?.[key] || item?.name || '').filter(Boolean);
}

function normalizeIds(items: any[]) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => item?.id).filter((id) => Number.isFinite(Number(id)));
}

async function downloadImage(
  imageUrl: string,
  imagesDir: string,
  existing: Pick<ImageInfo, 'localPath' | 'localUrl' | 'contentType' | 'sizeBytes'>
): Promise<Pick<ImageInfo, 'localPath' | 'localUrl' | 'contentType' | 'sizeBytes'>> {
  if (!imageUrl) {
    return { localPath: null, localUrl: null, contentType: null, sizeBytes: null };
  }

  fs.mkdirSync(imagesDir, { recursive: true });
  const fileName = getImageFileName(imageUrl);
  const filePath = path.join(imagesDir, fileName);

  if (fs.existsSync(filePath)) {
    const size = fs.statSync(filePath).size;
    return {
      localPath: filePath,
      localUrl: `/images/${fileName}`,
      contentType: existing.contentType || 'image/jpeg',
      sizeBytes: size,
    };
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_FETCH_RETRIES; attempt++) {
    try {
      const response = await axios.get<ArrayBuffer>(imageUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://shikimori.one/',
        },
        timeout: 30000,
      });

      const buffer = Buffer.from(response.data);
      try {
        fs.writeFileSync(filePath, buffer, { flag: 'wx' });
      } catch (error: any) {
        if (error?.code !== 'EEXIST') {
          throw error;
        }
      }

      const size = fs.statSync(filePath).size;
      return {
        localPath: filePath,
        localUrl: `/images/${fileName}`,
        contentType: String(response.headers['content-type'] || 'image/jpeg'),
        sizeBytes: size,
      };
    } catch (error) {
      lastError = error;
      if (fs.existsSync(filePath)) {
        const size = fs.statSync(filePath).size;
        return {
          localPath: filePath,
          localUrl: `/images/${fileName}`,
          contentType: existing.contentType || 'image/jpeg',
          sizeBytes: size,
        };
      }
      await sleep(DEFAULT_REQUEST_DELAY_MS * (attempt + 1));
    }
  }

  console.warn(`Image download failed, keeping anime row without local image: ${imageUrl}`, lastError);
  return {
    localPath: existing.localPath,
    localUrl: existing.localUrl,
    contentType: existing.contentType,
    sizeBytes: existing.sizeBytes,
  };
}

function insertAnime(db: Database, item: any, image: ImageInfo) {
  const genres = normalizeNames(item.genres, 'russian');
  const studios = normalizeNames(item.studios);
  const genreIds = normalizeIds(item.genres);
  const studioIds = normalizeIds(item.studios);
  const title = item.russian || item.name || String(item.id);

  const values: SqlValue[] = [
    Number(item.id),
    item.name || null,
    item.russian || null,
    title,
    item.kind || null,
    item.score ? Number(item.score) : null,
    item.status || null,
    item.episodes ?? null,
    item.episodes_aired ?? null,
    item.aired_on || null,
    item.released_on || null,
    extractYear(item),
    item.rating || null,
    JSON.stringify(item.english || []),
    JSON.stringify(item.synonyms || []),
    item.license_name_ru || null,
    item.description
      ?.replace(/\[.*?\]/g, '')
      ?.replace(/\n+/g, '\n')
      ?.trim() || '',
    item.description_html || null,
    image.url || null,
    image.originalUrl || null,
    image.previewUrl || null,
    image.x96Url || null,
    image.x48Url || null,
    image.localPath,
    image.localUrl,
    image.contentType,
    image.sizeBytes,
    JSON.stringify(genres),
    JSON.stringify(genreIds),
    JSON.stringify(studios),
    JSON.stringify(studioIds),
    item.country || null,
    JSON.stringify(item),
    new Date().toISOString(),
  ];

  db.prepare(
    `INSERT INTO shikimori_anime (
      id, name, russian, title, kind, score, status, episodes, episodes_aired,
      aired_on, released_on, year, rating, english, synonyms, license_name_ru,
      description, description_html, image_url, image_original_url, image_preview_url,
      image_x96_url, image_x48_url, image_local_path, image_local_url,
      image_content_type, image_size_bytes, genres, genre_ids, studios, studio_ids,
      country, raw_json, imported_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      russian = excluded.russian,
      title = excluded.title,
      kind = excluded.kind,
      score = excluded.score,
      status = excluded.status,
      episodes = excluded.episodes,
      episodes_aired = excluded.episodes_aired,
      aired_on = excluded.aired_on,
      released_on = excluded.released_on,
      year = excluded.year,
      rating = excluded.rating,
      english = excluded.english,
      synonyms = excluded.synonyms,
      license_name_ru = excluded.license_name_ru,
      description = excluded.description,
      description_html = excluded.description_html,
      image_url = excluded.image_url,
      image_original_url = excluded.image_original_url,
      image_preview_url = excluded.image_preview_url,
      image_x96_url = excluded.image_x96_url,
      image_x48_url = excluded.image_x48_url,
      image_local_path = excluded.image_local_path,
      image_local_url = excluded.image_local_url,
      image_content_type = excluded.image_content_type,
      image_size_bytes = excluded.image_size_bytes,
      genres = excluded.genres,
      genre_ids = excluded.genre_ids,
      studios = excluded.studios,
      studio_ids = excluded.studio_ids,
      country = excluded.country,
      raw_json = excluded.raw_json,
      imported_at = excluded.imported_at`
  ).run(values);
}

async function fetchAnimePage(page: number, limit: number) {
  return axiosGetWithRetry<any[]>(`${BASE_URL}/animes`, {
    order: 'id',
    page,
    limit,
    kind: getKindsParam(),
    genre: getExcludedGenresParam(),
  });
}

async function fetchAnimeDetails(id: number, delayMs: number) {
  if (delayMs > 0) {
    await sleep(delayMs);
  }
  return axiosGetWithRetry<any>(`${BASE_URL}/animes/${id}`);
}

async function importPage(
  db: Database,
  pageItems: any[],
  options: ImportOptions,
  stats: { totalImages: number; totalImageBytes: number }
) {
  const ids = pageItems.map((item) => Number(item.id)).filter((id) => Number.isFinite(id));
  const details = await mapWithConcurrency(ids, options.detailsConcurrency, async (id) => {
    return fetchAnimeDetails(id, options.requestDelayMs);
  });

  const imageInfos = await mapWithConcurrency(details, options.imageConcurrency, async (item) => {
    const urls = extractImageUrls(item);
    const existing = queryExistingImage(db, Number(item.id));
    const local = options.skipImages
      ? existing
      : await downloadImage(urls.url, options.imagesDir, existing);

    if (local.sizeBytes && (!existing.sizeBytes || local.sizeBytes !== existing.sizeBytes)) {
      stats.totalImages++;
      stats.totalImageBytes += local.sizeBytes;
    }

    return { ...urls, ...local };
  });

  db.run('BEGIN TRANSACTION');
  try {
    details.forEach((item, index) => insertAnime(db, item, imageInfos[index]));
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }

  return details.length;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log('AniSage Shikimori import starting');
  console.log(`Database: ${options.dbPath}`);
  console.log(`Images:   ${options.imagesDir}`);

  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  const db = fs.existsSync(options.dbPath)
    ? new SQL.Database(fs.readFileSync(options.dbPath))
    : new SQL.Database();

  const backupPath = ensureBackup(options.dbPath);
  if (backupPath) {
    console.log(`Backup:   ${backupPath}`);
  }

  createSchema(db);
  const runId = startRun(db);
  saveDb(db, options.dbPath);

  const stats = {
    totalSeen: 0,
    totalImported: 0,
    totalImages: 0,
    totalImageBytes: 0,
  };

  try {
    for (let page = 1; ; page++) {
      if (options.maxPages && page > options.maxPages) {
        break;
      }

      const pageItems = await fetchAnimePage(page, options.pageLimit);
      if (!Array.isArray(pageItems) || pageItems.length === 0) {
        break;
      }

      stats.totalSeen += pageItems.length;
      const imported = await importPage(db, pageItems, options, stats);
      stats.totalImported += imported;
      saveDb(db, options.dbPath);

      console.log(
        `Page ${page}: imported ${imported}, total ${stats.totalImported}, images ${stats.totalImages}, image bytes ${stats.totalImageBytes}`
      );
    }

    finishRun(db, runId, 'finished', stats);
    saveDb(db, options.dbPath);
    console.log('AniSage Shikimori import finished');
    console.log(JSON.stringify(stats, null, 2));
  } catch (error) {
    finishRun(db, runId, 'failed', stats, error);
    saveDb(db, options.dbPath);
    throw error;
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error('AniSage Shikimori import failed');
  console.error(error);
  process.exit(1);
});
