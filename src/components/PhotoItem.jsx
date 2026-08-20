import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Check } from 'lucide-react';
import {
  getItemId,
  pickTitle,
  pickPhotoSourceUrl,
  pickThumbnailUrl,
} from '../functions/mediaUtils.js';

const UNLOAD_DEBOUNCE_MS = 300;

let _sharedObserver = null;
const _callbackMap = new WeakMap();
const _unloadTimers = new WeakMap();

function getSharedObserver() {
  if (typeof window === 'undefined') return null;
  if (!_sharedObserver) {
    _sharedObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const cbs = _callbackMap.get(entry.target);
          if (!cbs) return;
          if (entry.isIntersecting) {
            const t = _unloadTimers.get(entry.target);
            if (t) { clearTimeout(t); _unloadTimers.delete(entry.target); }
            cbs.onEnter();
          } else {
            if (_unloadTimers.has(entry.target)) return;
            const t = setTimeout(() => {
              _unloadTimers.delete(entry.target);
              cbs.onLeave();
            }, UNLOAD_DEBOUNCE_MS);
            _unloadTimers.set(entry.target, t);
          }
        });
      },
      { rootMargin: '500px' }
    );
  }
  return _sharedObserver;
}

function getPhotoSelectionKey(item) {
  return String(
    getItemId(item) ??
      item?.__index ??
      item?.path ??
      item?.filePath ??
      item?.name ??
      item?.title ??
      ''
  );
}

const PhotoItem = React.memo(function PhotoItem({
  item,
  serverUrl,
  onClick,
  onToggleSelect,
  isSelected,
  canLoadImg = true,
}) {
  const cardRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const title = pickTitle(item);
  const sourceUrl = pickPhotoSourceUrl(serverUrl, item);
  const thumbUrl = pickThumbnailUrl(serverUrl, item);
  const selectionKey = getPhotoSelectionKey(item);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const observer = getSharedObserver();
    if (!observer) return;

    _callbackMap.set(el, {
      onEnter: () => setIsVisible(true),
      onLeave: () => {
        setIsVisible(false);
        setImgLoaded(false);
      },
    });
    observer.observe(el);

    return () => {
      const t = _unloadTimers.get(el);
      if (t) { clearTimeout(t); _unloadTimers.delete(el); }
      observer.unobserve(el);
      _callbackMap.delete(el);
    };
  }, []);

  const handleImageLoad = useCallback(() => {
    setImgLoaded(true);
  }, []);

  const handleImageError = useCallback(
    (event) => {
      const img = event.currentTarget;
      const fallback = sourceUrl || thumbUrl;
      if (img.dataset.fallbackApplied === 'true' || !fallback) return;
      img.dataset.fallbackApplied = 'true';
      img.src = fallback;
    },
    [sourceUrl, thumbUrl]
  );

  const showImage = isVisible && canLoadImg;

  return (
    <article
      ref={cardRef}
      id={`photo-card-${selectionKey}`}
      className={'visual-card visual-image-card select-none' + (isSelected ? ' is-selected' : '')}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      <div className="photo-card-media select-none">
        {showImage ? (
          <img
            src={thumbUrl || sourceUrl}
            alt={title}
            loading="lazy"
            decoding="async"
            data-loading={!imgLoaded ? 'true' : undefined}
            className={(imgLoaded ? 'photo-loaded ' : '') + 'select-none'}
            onLoad={handleImageLoad}
            onError={handleImageError}
            style={{ pointerEvents: 'auto', WebkitTouchCallout: 'default' }}
          />
        ) : (
          <div className="skeleton-image" style={{ aspectRatio: '4 / 5' }} />
        )}
      </div>
      <div className="photo-card-footer" onClick={(event) => event.stopPropagation()}>
        <div className="visual-meta">
          <div className="visual-title" title={title}>
            {title}
          </div>
        </div>
        {onToggleSelect && (
          <label
            className={'photo-select-control' + (isSelected ? ' selected' : '')}
            onClick={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(selectionKey)}
              aria-label={isSelected ? `Deselect ${title}` : `Select ${title}`}
            />
            <span className="photo-select-box" aria-hidden="true">
              {isSelected && <Check size={10} strokeWidth={3} />}
            </span>
          </label>
        )}
      </div>
    </article>
  );
});

export default PhotoItem;
