import initSqlJs, { Database } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { AnimeSummary, User, UserMetrics, UserRating } from './types';

const dbPath = path.resolve(process.cwd(), 'server.db');
let db: Database;

function saveDb() {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function execute(sql: string) {
  db.run(sql);
}

function queryGet(sql: string, params: any[] = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const result = stmt.step() ? stmt.getAsObject() : undefined;
  stmt.free();
  return result;
}

function queryAll(sql: string, params: any[] = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

export async function initDb() {
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  if (fs.existsSync(dbPath)) {
    const existing = fs.readFileSync(dbPath);
    db = new SQL.Database(existing);
  } else {
    db = new SQL.Database();
    execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        yandex_id TEXT UNIQUE NOT NULL,
        login TEXT,
        display_name TEXT,
        email TEXT,
        picture TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_ratings (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        anime_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        image TEXT,
        year INTEGER,
        studios TEXT,
        genres TEXT,
        raw_rating INTEGER NOT NULL,
        rating_normalized INTEGER NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, anime_id)
      );

      CREATE TABLE IF NOT EXISTS user_metrics (
        user_id INTEGER PRIMARY KEY,
        rating_count INTEGER DEFAULT 0,
        positive_count INTEGER DEFAULT 0,
        total_score REAL DEFAULT 0,
        year_weight_sum REAL DEFAULT 0,
        year_weight_sq_sum REAL DEFAULT 0,
        genre_sums TEXT DEFAULT '{}',
        genre_counts TEXT DEFAULT '{}',
        studio_weights TEXT DEFAULT '{}',
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS studios (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS studio_similarity (
        studio_a INTEGER NOT NULL,
        studio_b INTEGER NOT NULL,
        similarity REAL NOT NULL,
        PRIMARY KEY (studio_a, studio_b)
      );
    `);
    saveDb();
  }
  await seedStudios();
}

async function seedStudios() {
  const names = [
    'Madhouse',
    'Bones',
    'MAPPA',
    'Kyoto Animation',
    'Production I.G',
    'A-1 Pictures',
    'Studio Trigger',
    'SHAFT',
    'P.A.Works',
    'WIT Studio',
    'Ufotable',
    'Studio Ghibli',
    'Sunrise',
    'White Fox',
    'Studio Pierrot',
    'David Production',
    'Studio Deen',
    'J.C.Staff',
    'TMS Entertainment',
    'TROYCA'
  ];

  const insertStudio = db.prepare('INSERT OR IGNORE INTO studios (name) VALUES (?)');
  const insertSimilarity = db.prepare('INSERT OR IGNORE INTO studio_similarity (studio_a, studio_b, similarity) VALUES (?, ?, ?)');

  db.run('BEGIN TRANSACTION');
  names.forEach(name => insertStudio.run([name]));
  const studioIds = new Map<string, number>();
  names.forEach(name => {
    const row = queryGet('SELECT id FROM studios WHERE name = ?', [name]);
    if (row) studioIds.set(name, row.id);
  });
  names.forEach(nameA => {
    const idA = studioIds.get(nameA);
    if (!idA) return;
    names.forEach(nameB => {
      const idB = studioIds.get(nameB);
      if (!idB) return;
      let similarity = nameA === nameB ? 1 : 0.08;
      if ((nameA === 'Madhouse' && nameB === 'Bones') || (nameA === 'Bones' && nameB === 'Madhouse')) similarity = 0.2;
      if ((nameA === 'A-1 Pictures' && nameB === 'Production I.G') || (nameA === 'Production I.G' && nameB === 'A-1 Pictures')) similarity = 0.18;
      if ((nameA === 'Studio Trigger' && nameB === 'SHAFT') || (nameA === 'SHAFT' && nameB === 'Studio Trigger')) similarity = 0.15;
      if ((nameA === 'Ufotable' && nameB === 'WIT Studio') || (nameA === 'WIT Studio' && nameB === 'Ufotable')) similarity = 0.14;
      insertSimilarity.run([idA, idB, similarity]);
    });
  });
  db.run('COMMIT');
  saveDb();
}

function serializeRow(row: any) {
  if (!row) return undefined;
  return {
    ...row,
    studios: row.studios ? JSON.parse(row.studios) : [],
    genres: row.genres ? JSON.parse(row.genres) : []
  };
}

export function findUserByYandexId(yandexId: string): User | undefined {
  return queryGet('SELECT * FROM users WHERE yandex_id = ?', [yandexId]);
}

export function findUserById(id: number): User | undefined {
  return queryGet('SELECT * FROM users WHERE id = ?', [id]);
}

export function createUser(user: Omit<User, 'id'>): User {
  const result = db.prepare('INSERT INTO users (yandex_id, login, display_name, email, picture) VALUES (?, ?, ?, ?, ?)').run([
    user.yandex_id,
    user.login,
    user.display_name,
    user.email || null,
    user.picture || null
  ]);
  saveDb();
  return { id: Number(result.lastInsertRowid), ...user };
}

export function saveOrUpdateRating(rating: UserRating) {
  db.prepare(
    `INSERT INTO user_ratings (user_id, anime_id, title, image, year, studios, genres, raw_rating, rating_normalized)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, anime_id) DO UPDATE SET title = excluded.title,
       image = excluded.image,
       year = excluded.year,
       studios = excluded.studios,
       genres = excluded.genres,
       raw_rating = excluded.raw_rating,
       rating_normalized = excluded.rating_normalized,
       updated_at = CURRENT_TIMESTAMP`
  ).run([
    rating.user_id,
    rating.anime_id,
    rating.title,
    rating.image || null,
    rating.year || null,
    JSON.stringify(rating.studios || []),
    JSON.stringify(rating.genres || []),
    rating.raw_rating,
    rating.rating_normalized
  ]);
  saveDb();
}

export function getRatingsByUser(userId: number): UserRating[] {
  return queryAll('SELECT * FROM user_ratings WHERE user_id = ? ORDER BY updated_at DESC', [userId]).map((row: any) => ({
    ...row,
    studios: JSON.parse(row.studios || '[]'),
    genres: JSON.parse(row.genres || '[]')
  }));
}

export function getUserMetrics(userId: number): UserMetrics | undefined {
  const row = queryGet('SELECT * FROM user_metrics WHERE user_id = ?', [userId]);
  if (!row) return undefined;
  return {
    user_id: row.user_id,
    rating_count: row.rating_count,
    positive_count: row.positive_count,
    total_score: row.total_score,
    year_weight_sum: row.year_weight_sum,
    year_weight_sq_sum: row.year_weight_sq_sum,
    genre_sums: JSON.parse(row.genre_sums || '{}'),
    genre_counts: JSON.parse(row.genre_counts || '{}'),
    studio_weights: JSON.parse(row.studio_weights || '{}')
  };
}

export function saveUserMetrics(metrics: UserMetrics) {
  db.prepare(
    `INSERT INTO user_metrics (user_id, rating_count, positive_count, total_score, year_weight_sum, year_weight_sq_sum, genre_sums, genre_counts, studio_weights, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       rating_count = excluded.rating_count,
       positive_count = excluded.positive_count,
       total_score = excluded.total_score,
       year_weight_sum = excluded.year_weight_sum,
       year_weight_sq_sum = excluded.year_weight_sq_sum,
       genre_sums = excluded.genre_sums,
       genre_counts = excluded.genre_counts,
       studio_weights = excluded.studio_weights,
       updated_at = CURRENT_TIMESTAMP`
  ).run([
    metrics.user_id,
    metrics.rating_count,
    metrics.positive_count,
    metrics.total_score,
    metrics.year_weight_sum,
    metrics.year_weight_sq_sum,
    JSON.stringify(metrics.genre_sums || {}),
    JSON.stringify(metrics.genre_counts || {}),
    JSON.stringify(metrics.studio_weights || {})
  ]);
  saveDb();
}

export function getStudioSimilarities(): Record<string, Record<string, number>> {
  const rows = queryAll(
    `SELECT sa.name AS studio_a, sb.name AS studio_b, similarity
     FROM studio_similarity AS s
     JOIN studios AS sa ON s.studio_a = sa.id
     JOIN studios AS sb ON s.studio_b = sb.id`
  );
  const matrix: Record<string, Record<string, number>> = {};
  rows.forEach((row: any) => {
    matrix[row.studio_a] = matrix[row.studio_a] || {};
    matrix[row.studio_a][row.studio_b] = row.similarity;
  });
  return matrix;
}
