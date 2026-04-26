import React, { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate, useParams, useLocation } from 'react-router-dom';
import { getCurrentUser, fetchDiscover, searchAnime, getRatings, saveRating, getRecommendations } from './api.js';
import RatingCard from './components/RatingCard.jsx';

function Header({ user }) {
  if (!user) return null;
  
  const getPictureUrl = (pictureId) => 
    `https://avatars.yandex.net/get-yapic/${pictureId}/islands-200`

  return (
    <header className="app__header">
      <div>
        <h1 className="app__title">AniSage</h1>
        <p className="app__subtitle">Рекомендации на основе ваших оценок</p>
      </div>
      <img className="app__user-avatar" src={getPictureUrl(user.picture)} alt={user.display_name} />
    </header>
  );
}

function LoginPage({ error }) {
  return (
    <div className="app app--centered">
      <section className="login-card">
        <h1 className="login-card__title">AniSage</h1>
        <p className="login-card__text">Авторизуйтесь через Яндекс, чтобы начать получать рекомендации.</p>
        <a className="login-card__button" href="/auth/login">Войти через Яндекс</a>
        {error && <p className="login-card__error">{error}</p>}
      </section>
    </div>
  );
}

function RatingPage({ ratings, searchQuery, setSearchQuery, handleSearch, searchResults, discover, handleRate }) {
  return (
    <main className="rating-page">
      <section className="rating-page__search">
        <form className="search-form" onSubmit={handleSearch}>
          <input
            className="search-form__field"
            type="text"
            placeholder="Найти аниме"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <button className="search-form__button" type="submit">Поиск</button>
        </form>
      </section>

      <section className="rating-page__list">
        {(searchResults.length ? searchResults : discover).map((anime) => (
          <RatingCard key={anime.id} anime={anime} onRate={handleRate} />
        ))}
      </section>
    </main>
  );
}

function RecommendationsPage({ recommendations, ratings, searchQuery, setSearchQuery, handleSearch, searchResults, discover, handleRate }) {
  const hasEnoughRatings = ratings.length >= 5;
  
  return (
    <main className="recommendations-page">
      <section className="recommendations-page__search">
        <form className="search-form" onSubmit={handleSearch}>
          <input
            className="search-form__field"
            type="text"
            placeholder="Найти аниме"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <button className="search-form__button" type="submit">Поиск</button>
        </form>
      </section>

      {hasEnoughRatings && (
        <h2 className="recommendations-page__title">Ваши рекомендации</h2>
      )}

{!hasEnoughRatings ? (
        <section className="recommendations-page__list">
          <p className="app__info">Пожалуйста, оцените ваши первые 5 аниме, чтобы получить рекомендации</p>
        </section>
      ) : (
        <section className="recommendations-page__grid">
          {recommendations.map((anime) => (
              <article key={anime.id} className="recommendation-card">
                <div className="recommendation-card__image" style={{ backgroundImage: `url(${anime.image || ''})` }} />
                <div className="recommendation-card__body">
                  <h3 className="recommendation-card__title">{anime.title}</h3>
                  <p className="recommendation-card__meta">{anime.year || '—'} · {anime.genres?.slice(0, 3).join(', ')}</p>
                  <p className="recommendation-card__score">Score: {anime.score.toFixed(1)}</p>
                </div>
              </article>
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
  
  const [user, setUser] = useState(null);
  const [ratings, setRatings] = useState([]);
  const [discover, setDiscover] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [authChecked, setAuthChecked] = useState(false);

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

  async function handleSearch(event) {
    event.preventDefault();
    if (!searchQuery.trim()) return;
    try {
      const response = await searchAnime(searchQuery);
      setSearchResults(response.results);
      navigate('/search?q=' + encodeURIComponent(searchQuery));
    } catch (err) {
      setError('Поиск не удался. Попробуйте другой запрос.');
    }
  }

  const targetRoute = !user ? '/login' : '/recommendations';

  return (
    <div className="app">
      <Header user={user} />
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
              <RatingPage
                ratings={ratings}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                handleSearch={handleSearch}
                searchResults={searchResults}
                discover={discover}
                handleRate={handleRate}
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
                searchQuery={searchQuery} 
                setSearchQuery={setSearchQuery}
                handleSearch={handleSearch}
                searchResults={searchResults}
                discover={discover}
                handleRate={handleRate}
              />
            </PrivateRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;