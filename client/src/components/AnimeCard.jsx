import React, { useState } from 'react';

export default function AnimeCard({ anime, recommendations, withRating, initialRating, onRate }) {
  const [userRating, setUserRating] = useState(initialRating || 0);
  const [originalRating, setOriginalRating] = useState(initialRating || 0);
  const [saving, setSaving] = useState(false);

  const hasChanges = userRating !== originalRating;

  const handleSaveRating = async () => {
    setSaving(true);
    await onRate(anime.id, userRating, recommendations);
    setOriginalRating(userRating);
    setSaving(false);
  };

  if (withRating) {
    return (
      <div className="anime-card anime-card--with-rating">
        <a href={`/ani/${anime.id}${recommendations ? `?recommended=${recommendations}` : ''}`} className="anime-card__link">
          <div className="anime-card__image" style={{ backgroundImage: `url(${`/api/image?url=${encodeURIComponent(anime.image)}`|| ''})` }} />
        </a>
        <div className="anime-card__right">
          <a href={`/ani/${anime.id}${recommendations ? `?recommended=${recommendations}` : ''}`} className="anime-card__title-link">
            <p className="anime-card__title">{anime.title}</p>
          </a>
          <div className="anime-card__rating">
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
              className="anime-card__save-btn"
              disabled={!hasChanges || saving}
              onClick={handleSaveRating}
            >
              {saving ? 'Сохранение...' : 'Оценить'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <a href={`/ani/${anime.id}${recommendations ? `?recommended=${recommendations}` : ''}`} className="anime-card">
      <article className="anime-card">
        <div className="anime-card__image" style={{ backgroundImage: `url(${`/api/image?url=${encodeURIComponent(anime.image)}`|| ''})` }} />
        <p className="anime-card__title">{anime.title}</p>
      </article>
    </a>
  );
}