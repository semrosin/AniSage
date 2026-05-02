import React from 'react';

export default function AnimeCard({ anime, recommendations }) {
  return (
    <a href={`/ani/${anime.id}${recommendations ? `?recommended=${recommendations}` : ''}`} className="anime-card">
      <article className="anime-card">
        <div className="anime-card__image" style={{ backgroundImage: `url(${anime.image || ''})` }} />
        <p className="anime-card__title">{anime.title}</p>
      </article>
    </a>
  );
}
