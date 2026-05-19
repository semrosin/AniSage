import React from 'react';
import AnimeCard from '../components/AnimeCard.jsx';
import { RxExit, RxMoon, RxSun } from 'react-icons/rx';

const getPictureUrl = (pictureId) => 
  `https://avatars.yandex.net/get-yapic/${pictureId}/islands-200`;

function ratingToAnime(rating) {
  return {
    id: rating.anime_id,
    title: rating.title,
    image: rating.image || '',
    year: rating.year,
    genres: rating.genres || [],
    studios: rating.studios || [],
    score: 0,
  };
}

export default function RatingsPage({ user, ratings, onRate, onLogout, theme, onToggleTheme }) {
  if (!user) {
    return (
      <main className="ratings-page">
        <p className="app__info-block__title">Загрузка...</p>
      </main>
    );
  }

  const avatarSrc = user.is_guest
    ? '/images/default-avatar-anime-girl.jpg'
    : getPictureUrl(user.picture);

  const displayName = user.display_name;
  const isLightTheme = theme === 'light';
  const themeLabel = isLightTheme ? 'Включить тёмную тему' : 'Включить светлую тему';

  return (
    <main className="ratings-page">
      <div className="ratings-page__header">
        <div className="ratings-page__user-info">
          <h1 className="ratings-page__name">{displayName}</h1>
          {user.is_guest ? (
            <p className="ratings-page__email">
              <a href="/login" className="ratings-page__login-link" title="Перейти на страницу входа">Авторизуйтесь</a>, чтобы сохранить свои оценки
            </p>
          ) : (
            <p className="ratings-page__email">{user.email}</p>
          )}
        </div>
        <div className="ratings-page__actions">
          <button
            className="ratings-page__theme-toggle"
            type="button"
            onClick={onToggleTheme}
            aria-label={themeLabel}
            title={themeLabel}
          >
            {isLightTheme ? <RxMoon size={20} /> : <RxSun size={20} />}
          </button>
          {!user.is_guest && (
            <button className="ratings-page__logout" type="button" onClick={onLogout} aria-label="Выйти" title="Выйти из аккаунта">
              <span className="ratings-page__logout-text">Выйти</span>
              <RxExit className="ratings-page__logout-icon" size={20} />
            </button>
          )}
        </div>
      </div>
      <section className="ratings-page__list">
        {ratings.length === 0 ? (
          <p className="app__info-block__title">У вас пока нет оценок</p>
        ) : (
          ratings.map((rating) => (
            <AnimeCard
              key={rating.anime_id}
              anime={ratingToAnime(rating)}
              withRating={true}
              initialRating={rating.raw_rating}
              onRate={onRate}
            />
          ))
        )}
      </section>
    </main>
  );
}
