import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import {
  initDb,
  createUser,
  createGuestUser,
  findUserById,
  findUserByYandexId,
  findUserByAuthIdentity,
  getRatingsByUser,
  getUserMetrics,
  saveOrUpdateRating,
  saveUserMetrics,
  getStudioSimilarities,
  transferRatings
} from './db';
import { normalizeRating, buildMetricsFromRatings, buildRecommendations } from './recommendation';
import { fetchAnimeById, searchAnime, fetchPopularAnime, enrichCandidates, getEnoughCandidates } from './shikimori';
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

app.enable('trust proxy');
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: true,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

function getFileName(url: string) {
  return crypto.createHash('md5').update(url).digest('hex') + '.jpg';
}

// Helper to ensure session has a user (guest or real)
// Returns userId and ensures the session is saved for new guest users
async function ensureUser(req: express.Request, res: express.Response): Promise<number> {
  if (req.session?.userId && findUserById(req.session.userId)) return req.session.userId;
  const user = createGuestUser();
  req.session.userId = user.id;
  // Wait for session to be saved to ensure it persists across requests
  await new Promise<void>((resolve) => req.session.save(() => resolve()));
  return user.id;
}

function isGeneratedGuestLogin(login: string) {
  return /^user\d{10}$/.test(login);
}

app.get('/api/image', async (req, res) => {
  const url = decodeURIComponent(req.query.url as string);

  if (!url) {
    return res.status(400).send('No URL');
  }
  
  const dir = path.join(__dirname, 'uploads/images');

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const fileName = getFileName(url);
  const filePath = path.join(dir, fileName);

  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://shikimori.one/'
      }
    });

    if (!response.ok) {
      return res.status(500).send('Failed to fetch image');
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    fs.writeFileSync(filePath, buffer);

    res.set('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.send(buffer);

  } catch (err) {
    res.status(500).send('Error loading image');
  }
});

app.use('/images', express.static(path.join(__dirname, 'uploads/images')));
app.use('/public/images', express.static(path.join(__dirname, '..', 'public', 'images')));

app.get('/api/auth/login', (req, res) => {
  const callbackUrl = `${BASE_URL}/api/auth/yandex/callback`;
  const redirectUrl = `https://oauth.yandex.com/authorize?response_type=code&client_id=${YANDEX_CLIENT_ID}&redirect_uri=${encodeURIComponent(callbackUrl)}`;
  res.redirect(redirectUrl);
});

// Guest login - create anonymous user
app.post('/api/auth/guest', (req, res) => {
  const user = createGuestUser();
  req.session.userId = user.id;
  req.session.save(() => {
    // Return the unique guest login so the client can store it in localStorage
    res.json({ user: { ...user, is_guest: true }, guestLogin: user.login });
  });
});

// Restore guest session from localStorage-stored login
app.post('/api/auth/guest/restore', (req, res) => {
  const { login } = req.body as { login: string };
  if (!login || !isGeneratedGuestLogin(login)) {
    return res.json({ user: null });
  }
  const user = findUserByAuthIdentity('guest', login);
  if (!user || !user.is_guest) {
    return res.json({ user: null });
  }
  req.session.userId = user.id;
  req.session.save(() => {
    res.json({ user: { ...user, is_guest: true } });
  });
});

app.get('/api/auth/yandex/callback', async (req, res) => {
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
    
    // If user has a guest session, transfer ratings to the real user
    const guestUserId = req.session.userId;
    
    if (!user) {
      const displayName = userInfo.data.real_name || userInfo.data.name || userInfo.data.login || 'Яндекс пользователь';
      user = createUser({
        yandex_id: yandexId,
        login: userInfo.data.default_email || userInfo.data.login || '',
        display_name: displayName,
        email: userInfo.data.default_email || null,
        picture: userInfo.data.profile_picture || userInfo.data.avatar_id || userInfo.data.default_avatar_id || null
      }, { provider: 'yandex', providerUserId: yandexId });
    }

    // Transfer ratings from guest to real user
    if (guestUserId && guestUserId !== user.id) {
      const guestUser = findUserById(guestUserId);
      if (guestUser && (guestUser as any).is_guest) {
        transferRatings(guestUserId, user.id);
        const ratings = getRatingsByUser(user.id);
        saveUserMetrics(buildMetricsFromRatings(ratings));
      }
    }

    req.session.userId = user.id;
    res.redirect(CLIENT_URL);
  } catch (error) {
    console.error('Yandex OAuth error', error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ user: null });
  }
  const user = findUserById(req.session.userId);
  res.json({ user: user || null });
});

app.post('/api/auth/logout', (req, res) => {
  if (!req.session) {
    res.clearCookie('connect.sid');
    return res.json({ success: true });
  }

  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

app.get('/api/anime/search', async (req, res) => {
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

app.get('/api/anime/discover', async (req, res) => {
  try {
    const results = await fetchPopularAnime(40);
    res.json({ results });
  } catch (error) {
    console.error('Discover anime failed', error);
    res.status(500).json({ error: 'Discover failed' });
  }
});

app.get('/api/anime/:id', async (req, res) => {
  const animeId = parseInt(req.params.id);
  if (isNaN(animeId)) {
    return res.status(400).json({ error: 'Invalid anime id' });
  }

  try {
    const anime = await fetchAnimeById(animeId);
    res.json(anime);
  } catch (e) {
    res.status(404).json({ error: 'Anime not found' });
  }
});

app.get('/api/ratings', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ ratings: [] });
  }
  const userId = req.session.userId;
  const ratings = getRatingsByUser(userId);
  res.json({ ratings });
});

app.post('/api/ratings', async (req, res) => {
  // Ensure user exists (create guest if needed) — await session save for guests
  const userId = await ensureUser(req, res);
  if (req.session) {
    req.session.userId = userId;
  }
  const { animeId, rating, was_recommended } = req.body as { animeId: number; rating: number; was_recommended: boolean };
  if (!animeId || typeof rating !== 'number') {
    return res.status(400).json({ error: 'animeId and rating are required' });
  }

  try {
    const anime = await fetchAnimeById(animeId);
    const normalized = normalizeRating(rating);
    const ratingRow: UserRating = {
      user_id: userId,
      anime_id: anime.id,
      title: anime.title,
      image: anime.image,
      year: anime.year ?? null,
      studios: anime.studios,
      genres: anime.genres,
      raw_rating: rating,
      rating_normalized: normalized,
      was_recommended: was_recommended || false,
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

app.get('/api/recommendations', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userId = req.session.userId;
  const ratings = getRatingsByUser(userId);
  if (ratings.length < 5) {
    return res.status(400).json({ error: 'Please rate at least 5 anime to see recommendations.' });
  }
  const metrics = getUserMetrics(userId);
  if (!metrics) {
    return res.status(500).json({ error: 'Metrics not available' });
  }

  try {
    const candidates = await getEnoughCandidates(new Set(ratings.map(r => r.anime_id)));
    const enrichedCandidates = await enrichCandidates(candidates);
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
