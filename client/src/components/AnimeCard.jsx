import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export default function AnimeCard({ anime, recommendations, withRating, initialRating, onRate }) {
  const [userRating, setUserRating] = useState(initialRating || 0);
  const [originalRating, setOriginalRating] = useState(initialRating || 0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const nextRating = initialRating || 0;
    setUserRating(nextRating);
    setOriginalRating(nextRating);
  }, [anime.id, initialRating]);

  const hasChanges = userRating !== originalRating;
  const animeUrl = `/anime/${anime.id}${recommendations ? `?recommended=${recommendations}` : ''}`;

  const handleSaveRating = async () => {
    setSaving(true);
    await onRate(anime.id, userRating, recommendations);
    setOriginalRating(userRating);
    setSaving(false);
  };

  if (withRating) {
    return (
      <div className="anime-card anime-card--with-rating">
        <Link to={animeUrl} state={{ anime }} className="anime-card__link">
          <div className="anime-card__image" style={{ backgroundImage: `url(${`/api/image?url=${encodeURIComponent(anime.image)}`|| ''})` }} />
        </Link>
        <div className="anime-card__right">
          <Link to={animeUrl} state={{ anime }} className="anime-card__title-link">
            <p className="anime-card__title">{anime.title}</p>
          </Link>
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
    <Link to={animeUrl} state={{ anime }} className="anime-card">
      <article className="anime-card">
        <div className="anime-card__image" style={{ backgroundImage: `url(${`/api/image?url=${encodeURIComponent(anime.image)}`|| ''})` }} />
        <p className="anime-card__title">{anime.title}</p>
      </article>
    </Link>
  );
}
