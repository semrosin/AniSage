const defaultOptions = {
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json'
  }
};

const API_PREFIX = '/api';

async function request(path, options = {}) {
  const response = await fetch(path, { ...defaultOptions, ...options });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

export function getCurrentUser() {
  return request(`${API_PREFIX}/auth/me`);
}

export function logout() {
  return request(`${API_PREFIX}/auth/logout`, { method: 'POST' });
}

export function createGuest() {
  return request(`${API_PREFIX}/auth/guest`, { method: 'POST' });
}

export function restoreGuest(login) {
  return request(`${API_PREFIX}/auth/guest/restore`, {
    method: 'POST',
    body: JSON.stringify({ login })
  });
}

function mapAnimeFields(item) {
  return {
    id: item.anime_id || item.id,
    title: item.title,
    image: item.poster_url || item.image || item.poster || '',
    year: item.release_year || item.year || item.year_of_release || null,
    genres: item.genres || item.categories || [],
    score: parseFloat(item.score || item.rating || item.mean_score) || 0
  };
}

function hasPreviewImage(anime) {
  const image = anime.image || '';
  const decodedImage = decodeURIComponent(image);
  return image && !decodedImage.includes('missing_preview.jpg');
}

export async function fetchDiscover() {
  const data = await request(`${API_PREFIX}/anime/discover`);
  return {
    ...data,
    results: data.results?.map(mapAnimeFields).filter(hasPreviewImage) || []
  };
}

export async function searchAnime(query) {
  const data = await request(`${API_PREFIX}/anime/search?q=${encodeURIComponent(query)}`);
  return {
    ...data,
    results: data.results?.map(mapAnimeFields) || []
  };
}

export function getRatings() {
  return request(`${API_PREFIX}/ratings`);
}

export function saveRating(animeId, rating, was_recommended = false) {
  return request(`${API_PREFIX}/ratings`, {
    method: 'POST',
    body: JSON.stringify({ animeId, rating, was_recommended })
  });
}

export async function getRecommendations() {
  const data = await request(`${API_PREFIX}/recommendations`);
  return {
    ...data,
    recommendations: data.recommendations?.map(mapAnimeFields) || []
  };
}

export function getAnimeDetails(animeId) {
  return request(`${API_PREFIX}/anime/${animeId}`);
}
