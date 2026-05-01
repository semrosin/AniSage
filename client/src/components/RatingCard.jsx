import React from 'react';

export default function AnimeCard({ anime, onRate }) {
  return (
    <article className="anime-card">
      <div className="anime-card__image" style={{ backgroundImage: `url(${anime.image || ''})` }} />
      <p className="anime-card__title">{anime.title}</p>
    </article>
  );
}
