const defaultOptions = {
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json'
  }
};

async function request(path, options = {}) {
  const response = await fetch(path, { ...defaultOptions, ...options });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

export function getCurrentUser() {
  return request('/auth/me');
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

export async function fetchDiscover() {
  const data = await request('/anime/discover');
  return {
    ...data,
    results: data.results?.map(mapAnimeFields) || []
  };
}

export async function searchAnime(query) {
  const data = await request(`/anime/search?q=${encodeURIComponent(query)}`);
  return {
    ...data,
    results: data.results?.map(mapAnimeFields) || []
  };
}

export function getRatings() {
  return request('/ratings');
}

export function saveRating(animeId, rating) {
  return request('/ratings', {
    method: 'POST',
    body: JSON.stringify({ animeId, rating })
  });
}

export async function getRecommendations() {
  const data = await request('/api/recommendations');
  return {
    ...data,
    recommendations: data.recommendations?.map(mapAnimeFields) || []
  };
}

export function getAnimeDetails(animeId) {
  return request(`/anime/${animeId}`);
}
