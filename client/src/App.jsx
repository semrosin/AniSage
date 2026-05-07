import React, { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom';
import { getCurrentUser, createGuest, restoreGuest, fetchDiscover, searchAnime, getRatings, saveRating, getRecommendations, getAnimeDetails } from './api.js';
import AnimeCard from './components/AnimeCard.jsx';
import PrivacyPolicy from './pages/PrivacyPolicy.jsx';
import RatingsPage from './pages/RatingsPage.jsx';
import { TbBrandYandex } from "react-icons/tb";
import { CiSearch } from "react-icons/ci";
import { FaHeart, FaGithub } from "react-icons/fa6";
import parser from "bbcode-to-react";

function Header({ user, handleSearch, searchQuery, setSearchQuery }) {
  if (!user) return null;
  
  const getPictureUrl = (pictureId) => 
    `https://avatars.yandex.net/get-yapic/${pictureId}/islands-200`

  const avatarSrc = user.is_guest
    ? '/images/default-avatar-anime-girl.jpg'
    : getPictureUrl(user.picture);

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
      <a href="/userrates" className="app__user-link">
        <img className="app__user-avatar" src={avatarSrc} alt={user.display_name} />
      </a>
    </header>
  );
}

function AnimePage({ ratings, onRate }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const recommended = searchParams.get('recommended') || false;
  const [anime, setAnime] = useState(null);
  const [userRating, setUserRating] = useState(0);
  const [originalRating, setOriginalRating] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAnimeDetails(id).then(data => {
      setAnime(data);
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
    await onRate(parseInt(id), userRating, recommended);
    setOriginalRating(userRating);
    setSaving(false);
  };

  const hasChanges = userRating !== originalRating;

  if (loading) {
    return <p className="app__info-block__title">Загрузка...</p>;
  }

  if (!anime) {
    return <p className="app__error">Аниме не найдено</p>;
  }

  return (
    <main className="anime-page">
      <div className="anime-page__poster">
        <img src={`/api/image?url=${encodeURIComponent(anime.image)}`} alt={anime.title} />
      </div>

      <div className="anime-page__info">
        <h1 className="anime-page__title">{anime.title}</h1>
        
        <div className="anime-page__meta">
          <p><strong>Год выпуска</strong> <span>{anime.year || 'Ещё не вышло'}</span></p>
          <p><strong>Жанры</strong> <span>{anime.genres?.join(', ') || '—'}</span></p>
          <p><strong>Студии</strong> <span>{anime.studios?.join(', ') || '—'}</span></p>
          <p><strong>Средняя оценка</strong> <span>{Number(anime.score)?.toFixed(1) || '—'}</span></p>
          <p><strong>Эпизодов</strong> <span>{anime.episodes || '—'}</span></p>
        </div>

        <div className="anime-page__description">
          <p><strong>Описание</strong></p>
          <p>{parser.toReact(anime.description || "—")}</p>
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

function SearchPage({ searchQuery, searchResults, discover, ratings = [], onRate }) {
  const isSearching = searchQuery && searchResults.length === 0;
  const animeList = searchResults.length ? searchResults : discover;

  function getInitialRating(animeId) {
    return ratings.find((rating) => rating.anime_id == animeId)?.raw_rating || 0;
  }

  return (
    <main className="search-page">
      {searchQuery && (
        <h2 className="search-page__title">Результаты поиска по запросу "{searchQuery}"</h2>
      )}
      <section className="ratings-page__list">
        {isSearching ? (
          <p className="app__info-block__title">Загрузка...</p>
        ) : (
          animeList.map((anime) => (
            <AnimeCard
              key={anime.id}
              anime={anime}
              withRating={true}
              initialRating={getInitialRating(anime.id)}
              onRate={onRate}
            />
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
        <section className="app__info-block__title-block">
          <p className="app__info-block__title-block__title">Пожалуйста, оцените ваши первые 5 аниме, чтобы получить рекомендации</p>
        </section>
      ) : (
        <section className="anime-list">
          {recommendations.map((anime) => (
            <AnimeCard key={anime.id} anime={anime} recommendations={true} withRating={false} />
          ))}
      </section>
      )}
    </main>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-left">
        <NavLink to="/privacy" className="footer-link">Политика конфиденциальности</NavLink>
      </div>
      <div className="footer-right">
        <a href="https://github.com/semrosin/AniSage" target="_blank" rel="noopener noreferrer" className="footer-icon">
          <FaGithub size={22} />
        </a>
        <a href="https://boosty.to/semrosin/donate" target="_blank" rel="noopener noreferrer" className="footer-icon footer-icon--heart">
          <FaHeart size={22} />
        </a>
      </div>
    </footer>
  );
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
        if (!response.user.is_guest) {
          localStorage.removeItem('guestLogin');
        }
        await loadRatings();
        setAuthChecked(true);
        return;
      }

      // No active session — try to restore guest from localStorage
      const savedLogin = localStorage.getItem('guestLogin');
      if (savedLogin) {
        try {
          const restoreResponse = await restoreGuest(savedLogin);
          if (restoreResponse.user) {
            setUser(restoreResponse.user);
            await loadRatings();
            setAuthChecked(true);
            return;
          }
        } catch (e) {
          // restore failed, will create new guest
        }
      }

      // No saved guest or restore failed — create new guest
      try {
        const guestResponse = await createGuest();
        setUser(guestResponse.user);
        // Save guest login to localStorage for session persistence across reloads
        if (guestResponse.guestLogin) {
          localStorage.setItem('guestLogin', guestResponse.guestLogin);
        }
      } catch (err) {
        setError('Не удалось создать гостевую сессию');
        setAuthChecked(true);
        setStatus('ready');
        return;
      }

      await loadRatings();
      setAuthChecked(true);
    } catch (err) {
      setStatus('ready');
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

  async function handleRate(animeId, value, was_recommended = false) {
    setError('');
    try {
      await saveRating(animeId, value, was_recommended);
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

  if (!authChecked) {
    return (
      <>
        <Header user={null} />
        <div className="app">
          <p className="app__info-block__title">Загрузка...</p>
        </div>
        <Footer />
      </>
    );
  }

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
              !user ? (
                <p className="app__info-block__title">Загрузка...</p>
              ) : (
                <Navigate to={status === 'recommendations' ? '/recommendations' : '/discover'} replace />
              )
            }
          />
          <Route path="/login" element={<LoginPage error={error} />} />
          <Route
            path="/discover"
            element={
              <SearchPage
                searchQuery={''}
                searchResults={[]}
                discover={discover}
                ratings={ratings}
                onRate={handleRate}
              />
            }
          />
          <Route
            path={`/search`}
            element={
              <SearchPage
                searchQuery={searchQuery}
                searchResults={searchResults}
                discover={discover}
                ratings={ratings}
                onRate={handleRate}
              />
            }
          />
          <Route
            path="/userrates"
            element={
              <RatingsPage
                user={user}
                ratings={ratings}
                onRate={handleRate}
              />
            }
          />
          <Route
            path="/recommendations"
            element={
              <RecommendationsPage 
                recommendations={recommendations}
                ratings={ratings}
              />
            }
          />
          <Route
            path="/ani/:id"
            element={
              <AnimePage
                ratings={ratings}
                onRate={handleRate}
              />
            }
          />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <Footer />
    </>
  );
}

export default App;
