import React from 'react';

export function SkeletonPhotoCard() {
  return (
    <article className="visual-card visual-image-card skeleton-card">
      <div className="skeleton-image" />
      <div className="visual-meta">
        <div className="skeleton-text title-skeleton" />
      </div>
    </article>
  );
}

export function SkeletonMediaItem() {
  return (
    <li className="music-item skeleton-item">
      <div className="music-art skeleton-art" />
      <div className="music-main">
        <div className="skeleton-text title-skeleton" />
        <div className="music-details">
          <div className="skeleton-text artist-skeleton" />
          <div className="skeleton-text meta-skeleton" />
        </div>
      </div>
      <div className="music-actions">
        <div className="skeleton-action" />
      </div>
    </li>
  );
}
