import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import {
  initDb,
  createUser,
  findUserById,
  findUserByYandexId,
  getRatingsByUser,
  getUserMetrics,
  saveOrUpdateRating,
  saveUserMetrics,
  getStudioSimilarities
} from './db';
import { normalizeRating, buildMetricsFromRatings, buildRecommendations } from './recommendation';
import { fetchAnimeById, searchAnime, fetchPopularAnime, enrichCandidates, filterEroticAnime } from './shikimori';
import { UserRating } from './types';

dotenv.config();
const PORT = Number(process.env.PORT || 4000);
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const YANDEX_CLIENT_ID = process.env.YANDEX_CLIENT_ID;
const YANDEX_CLIENT_SECRET = process.env.YANDEX_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me';

if (!YANDEX_CLIENT_ID || !YANDEX_CLIENT_SECRET) {
  console.warn('YANDEX_CLIENT_ID and YANDEX_CLIENT_SECRET should be set in server/.env');
}

let similarityMatrix: Record<string, Record<string, number>> = {};
const app = express();

app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/auth/login', (req, res) => {
  const callbackUrl = `${BASE_URL}/auth/yandex/callback`;
  const redirectUrl = `https://oauth.yandex.com/authorize?response_type=code&client_id=${YANDEX_CLIENT_ID}&redirect_uri=${encodeURIComponent(callbackUrl)}`;
  res.redirect(redirectUrl);
});

app.get('/auth/yandex/callback', async (req, res) => {
  const code = String(req.query.code || '');
  if (!code) {
    return res.status(400).send('Missing code');
  }

  try {
    const tokenResponse = await axios.post(
      'https://oauth.yandex.com/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: YANDEX_CLIENT_ID || '',
        client_secret: YANDEX_CLIENT_SECRET || ''
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenResponse.data.access_token;
    const userInfo = await axios.get('https://login.yandex.ru/info?format=json', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const yandexId = String(userInfo.data.id);
    let user = findUserByYandexId(yandexId);
    if (!user) {
      user = createUser({
        yandex_id: yandexId,
        login: userInfo.data.default_email || userInfo.data.login || '',
        display_name: userInfo.data.real_name || userInfo.data.name || userInfo.data.login || 'Яндекс пользователь',
        email: userInfo.data.default_email || null,
        picture: userInfo.data.profile_picture || userInfo.data.avatar_id || userInfo.data.default_avatar_id || null
      });
    }

    req.session.userId = user.id;
    res.redirect(CLIENT_URL);
  } catch (error) {
    console.error('Yandex OAuth error', error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/auth/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ user: null });
  }
  const user = findUserById(req.session.userId);
  res.json({ user: user || null });
});

app.get('/anime/search', async (req, res) => {
  const query = String(req.query.q || '');
  if (!query) {
    return res.status(400).json({ error: 'Search query required' });
  }
  try {
    const results = await searchAnime(query);
    res.json({ results });
  } catch (error) {
    console.error('Search anime failed', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.get('/anime/discover', async (req, res) => {
  try {
    const results = await fetchPopularAnime(40);
    res.json({ results });
  } catch (error) {
    console.error('Discover anime failed', error);
    res.status(500).json({ error: 'Discover failed' });
  }
});

app.get('/ratings', requireAuth, (req, res) => {
  const userId = req.session.userId!;
  const ratings = getRatingsByUser(userId);
  res.json({ ratings });
});

app.post('/ratings', requireAuth, async (req, res) => {
  const { animeId, rating } = req.body as { animeId: number; rating: number };
  if (!animeId || typeof rating !== 'number') {
    return res.status(400).json({ error: 'animeId and rating are required' });
  }

  try {
    const anime = await fetchAnimeById(animeId);
    const normalized = normalizeRating(rating);
    const userId = req.session.userId!;
    const ratingRow: UserRating = {
      user_id: userId,
      anime_id: anime.id,
      title: anime.title,
      image: anime.image,
      year: anime.year ?? null,
      studios: anime.studios,
      genres: anime.genres,
      raw_rating: rating,
      rating_normalized: normalized
    };
    saveOrUpdateRating(ratingRow);
    const ratings = getRatingsByUser(userId);
    saveUserMetrics(buildMetricsFromRatings(ratings));
    res.json({ success: true, ratings });
  } catch (error) {
    console.error('Save rating failed', error);
    res.status(500).json({ error: 'Failed to save rating' });
  }
});

app.get('/api/recommendations', requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const ratings = getRatingsByUser(userId);
  if (ratings.length < 5) {
    return res.status(400).json({ error: 'Please rate at least 5 anime to see recommendations.' });
  }
  const metrics = getUserMetrics(userId);
  if (!metrics) {
    return res.status(500).json({ error: 'Metrics not available' });
  }

  try {
    const candidates = await fetchPopularAnime(40);
    const enrichedCandidates = await enrichCandidates(candidates, 40);
    // const filteredCandidates = filterEroticAnime(enrichedCandidates);
    const recommendations = buildRecommendations(enrichedCandidates, ratings, metrics, similarityMatrix);
    res.json({ recommendations });
  } catch (error) {
    console.error('Recommendations failed', error);
    res.status(500).json({ error: 'Recommendations failed' });
  }
});

async function main() {
  await initDb();
  similarityMatrix = getStudioSimilarities();
  app.listen(PORT, () => {
    console.log(`AniSage server listening at http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error('Failed to start AniSage server', error);
  process.exit(1);
});
