import React from 'react';

export default function RatingCard({ anime, onRate }) {
  return (
    <article className="rating-card">
      <div className="rating-card__image" style={{ backgroundImage: `url(${anime.image || ''})` }} />
      <div className="rating-card__content">
        <div>
          <h3 className="rating-card__title">{anime.title}</h3>
          <div className="rating-card__meta">
            <span>{anime.year || '—'}</span>
            <span>{anime.genres?.slice(0, 3).join(', ')}</span>
          </div>
        </div>
        <div className="rating-card__actions">
          {[1,2,3,4,5,6,7,8,9,10].map(value => (
            <button
              key={value}
              className="rating-card__button"
              type="button"
              onClick={() => onRate(anime.id, value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}
