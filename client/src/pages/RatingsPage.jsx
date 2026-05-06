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
  return (
    <main className="ratings-page">
      <div className="ratings-page__header">
        <img className="ratings-page__avatar" src={getPictureUrl(user.picture)} alt={user.display_name} />
        <div className="ratings-page__user-info">
          <h1 className="ratings-page__name">{user.display_name}</h1>
          <p className="ratings-page__email">{user.email}</p>
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