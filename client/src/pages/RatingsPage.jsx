import React from 'react';
import AnimeCard from '../components/AnimeCard.jsx';

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

export default function RatingsPage({ user, ratings, onRate }) {
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

  return (
    <main className="ratings-page">
      <div className="ratings-page__header">
        <img className="ratings-page__avatar" src={avatarSrc} alt={displayName} />
        <div className="ratings-page__user-info">
          <h1 className="ratings-page__name">{displayName}</h1>
          {user.is_guest ? (
            <p className="ratings-page__email">
              <a href="/api/auth/login" className="ratings-page__login-link">Авторизуйтесь</a>, чтобы сохранить свои оценки
            </p>
          ) : (
            <p className="ratings-page__email">{user.email}</p>
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
