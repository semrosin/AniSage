import React, { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate, useParams, useLocation } from 'react-router-dom';
import { getCurrentUser, fetchDiscover, searchAnime, getRatings, saveRating, getRecommendations, getAnimeDetails } from './api.js';
import AnimeCard from './components/AnimeCard.jsx';
import { TbBrandYandex } from "react-icons/tb";
import { CiSearch } from "react-icons/ci";
import parser from "bbcode-to-react";

function Header({ user, handleSearch, searchQuery, setSearchQuery }) {
  if (!user) return null;
  
  const getPictureUrl = (pictureId) => 
    `https://avatars.yandex.net/get-yapic/${pictureId}/islands-200`

  return (
    <header className="app__header">
      <div>
        <a href="/" className="app__logo-link">
          <img className="app__logo app__logo--default" src="/Logo.svg" alt="AniSage" />
          <img className="app__logo app__logo--rotated" src="/Logo_Rotated.svg" alt="AniSage" />
        </a>
      </div>
      <form className="search-form" onSubmit={handleSearch}>
          <input
            className="search-form__field"
            type="text"
            placeholder="Найти аниме"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <button className="search-form__button" type="submit">
            <CiSearch size={20}/>
          </button>
      </form>
      <img className="app__user-avatar" src={getPictureUrl(user.picture)} alt={user.display_name} />
    </header>
  );
}

function AnimePage({ ratings, onRate }) {
  const { id } = useParams();
  const [anime, setAnime] = useState(null);
  const [userRating, setUserRating] = useState(0);
  const [originalRating, setOriginalRating] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAnimeDetails(id).then(data => {
      setAnime(data);
      console.log('Anime details:', data);
      const existingRating = ratings.find(r => r.anime_id == id);
      if (existingRating) {
        setUserRating(existingRating.raw_rating);
        setOriginalRating(existingRating.raw_rating);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id, ratings]);

  const handleSaveRating = async () => {
    setSaving(true);
    await onRate(parseInt(id), userRating);
    setOriginalRating(userRating);
    setSaving(false);
  };

  const hasChanges = userRating !== originalRating;

  if (loading) {
    return <p className="app__info">Загрузка...</p>;
  }

  if (!anime) {
    return <p className="app__error">Аниме не найдено</p>;
  }

  return (
    <main className="anime-page">
      <div className="anime-page__poster">
        <img src={anime.image} alt={anime.title} />
      </div>

      <div className="anime-page__info">
        <h1 className="anime-page__title">{anime.title}</h1>
        
        <div className="anime-page__meta">
          <p><strong>Год</strong> <span>{anime.year || '—'}</span></p>
          <p><strong>Жанры</strong> <span>{anime.genres?.join(', ') || '—'}</span></p>
          <p><strong>Студия</strong> <span>{anime.studios?.join(', ') || '—'}</span></p>
          <p><strong>Средняя оценка</strong> <span>{Number(anime.score)?.toFixed(1) || '—'}</span></p>
          <p><strong>Эпизодов</strong> <span>{anime.episodes || '—'}</span></p>
          <p><strong>Описание</strong> <span>{parser.toReact(anime.description || "—")}</span></p>
        </div>

        <div className="anime-page__rating">
          <div className="stars">
            {Array.from({ length: 10 }, (_, i) => i + 1).map(star => (
              <button
                key={star}
                className={`star ${star <= userRating ? 'star--active' : ''}`}
                onClick={() => setUserRating(star)}
              >
                ★
              </button>
            ))}
          </div>
          
          <button
            className="anime-page__save-btn"
            disabled={!hasChanges || saving}
            onClick={handleSaveRating}
          >
            {saving ? 'Сохранение...' : 'Оценить'}
          </button>
        </div>
      </div>
    </main>
  );
}

function LoginPage({ error }) {
  return (
    <div className="app app--centered">
      <section className="login-card">
        <h1 className="login-card__title">Войдите с помощью</h1>
        <div className='login-card__buttons'>
          <a className="login-card__button" href="/auth/login">
            <TbBrandYandex size={25}/>
          </a>
        </div>
        {error && <p className="login-card__error">{error}</p>}
      </section>
    </div>
  );
}

function SearchPage({ searchQuery, searchResults, discover }) {
  const isSearching = searchQuery && searchResults.length === 0;

  return (
    <main className="search-page">
      {searchQuery && (
        <h2 className="search-page__title">Результаты поиска по запросу "{searchQuery}"</h2>
      )}
      <section className="anime-list">
        {isSearching ? (
          <p className="app__info">Загрузка...</p>
        ) : (
          (searchResults.length ? searchResults : discover).map((anime) => (
            <AnimeCard key={anime.id} anime={anime} />
          ))
        )}
      </section>
    </main>
  );
}

function RecommendationsPage({ recommendations, ratings }) {
  const hasEnoughRatings = ratings.length >= 5;
  
  return (
    <main className="recommendations-page">
      {hasEnoughRatings && (
        <h2 className="recommendations-page__title">Ваши рекомендации</h2>
      )}

      {!hasEnoughRatings ? (
        <section className="anime-list">
          <p className="app__info">Пожалуйста, оцените ваши первые 5 аниме, чтобы получить рекомендации</p>
        </section>
      ) : (
        <section className="anime-list">
          {recommendations.map((anime) => (
            <AnimeCard key={anime.id} anime={anime} />
          ))}
      </section>
      )}
    </main>
  );
}

function PrivateRoute({ allow, redirectTo, authChecked, status, user, children }) {
  if (!authChecked) {
    return <p className="app__info">Загрузка...</p>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!allow) {
    return <Navigate to={redirectTo} replace />;
  }
  return children;
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  
  const [user, setUser] = useState(null);
  const [ratings, setRatings] = useState([]);
  const [discover, setDiscover] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [authChecked, setAuthChecked] = useState(false);

  const urlParams = new URLSearchParams(location.search);
  const searchQuery = urlParams.get('q') || '';

  useEffect(() => {
    loadUser();
  }, []);

  async function loadUser() {
    try {
      const response = await getCurrentUser();
      if (response.user) {
        setUser(response.user);
        await loadRatings();
      } else {
        setStatus('ready');
      }
    } catch (err) {
      setError('Не удалось получить данные пользователя.');
      setStatus('ready');
    } finally {
      setAuthChecked(true);
    }
  }

  async function loadRatings() {
    try {
      const response = await getRatings();
      setRatings(response.ratings);
      if (response.ratings.length < 5) {
        const discoverResponse = await fetchDiscover();
        setDiscover(discoverResponse.results);
        return;
      }
      await loadRecommendations();
    } finally {
      setStatus('recommendations');
    }
  }

  async function loadRecommendations() {
    try {
      const response = await getRecommendations();
      setRecommendations(response.recommendations);
    } finally {
      setStatus('recommendations');
    }
  }

  async function handleRate(animeId, value) {
    setError('');
    try {
      await saveRating(animeId, value);
      await loadRatings();
    } catch (err) {
      setError('Не удалось сохранить оценку.');
    }
  }

  function setSearchQuery(value) {
    const params = new URLSearchParams(location.search);
    if (value) {
      params.set('q', value);
    } else {
      params.delete('q');
    }
    navigate(`${location.pathname}?${params.toString()}`, { replace: true });
  }

  function handleSearch(event) {
    event.preventDefault();
    if (!searchQuery.trim()) return;
    navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
  }

  useEffect(() => {
    if (location.pathname === '/search' && searchQuery.trim()) {
      setSearchResults([]);
      searchAnime(searchQuery)
        .then(response => setSearchResults(response.results))
        .catch(() => setError('Поиск не удался. Попробуйте другой запрос.'));
    }
  }, [searchQuery, location.pathname]);

  const targetRoute = !user ? '/login' : '/recommendations';

  return (
    <>
      <Header
        user={user}
        searchQuery={searchQuery} 
        setSearchQuery={setSearchQuery}
        handleSearch={handleSearch}
      />
      <div className="app">
        {error && <p className="app__error">{error}</p>}
        <Routes>
          <Route
            path="/"
            element={
              !authChecked ? (
                <p className="app__info">Загрузка...</p>
              ) : !user ? (
                <Navigate to="/login" replace />
              ) : (
                <Navigate to={targetRoute} replace />
              )
            }
          />
          <Route path="/login" element={user ? <Navigate to={targetRoute} replace /> : <LoginPage error={error} />} />
          <Route
            path={`/search`}
            element={
              <PrivateRoute allow={true} redirectTo="/login" authChecked={authChecked} status={status} user={user}>
                <SearchPage
                  searchQuery={searchQuery}
                  searchResults={searchResults}
                  discover={discover}
                />
              </PrivateRoute>
            }
          />
          <Route
            path="/recommendations"
            element={
              <PrivateRoute allow={true} redirectTo="/login" authChecked={authChecked} status={status} user={user}>
                <RecommendationsPage 
                  recommendations={recommendations}
                  ratings={ratings}
                />
              </PrivateRoute>
            }
          />
          <Route
            path="/ani/:id"
            element={
              <PrivateRoute allow={true} redirectTo="/login" authChecked={authChecked} status={status} user={user}>
                <AnimePage
                  ratings={ratings}
                  onRate={handleRate}
                />
              </PrivateRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </>
  );
}

export default App;