import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Play, Rewind, FastForward, SkipBack, SkipForward } from 'lucide-react';
import { fetchMediaItemsCached, getMediaEndpoint } from './mediaApiCache.js';

const STORAGE_KEY = 'localstream_server_url';

function getMediaType(item) {
  const raw = (item && (item.type || item.mediaType || item.kind || '')) || '';
  return String(raw).trim().toUpperCase();
}

function getItemId(item) {
  if (!item) return null;
  const id = item.id ?? item.mediaId ?? item.videoId ?? item.imageId;
  return id != null ? id : null;
}

function pickTitle(item) {
  if (!item) return 'Untitled';
  const raw = item.title || item.name || item.fileName || item.filename || '';
  const text = String(raw).trim();
  return text || 'Untitled';
}

function pickDateValue(item) {
  if (!item) return 0;
  const raw =
    item.date ||
    item.added ||
    item.addedAt ||
    item.createdAt ||
    item.modifiedAt ||
    item.lastModified ||
    item.mtime ||
    item.timestamp ||
    '';
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  const fromDate = Date.parse(String(raw));
  if (Number.isNaN(fromDate)) return 0;
  return fromDate;
}

function normalizeDurationSeconds(raw) {
  if (raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;

  if (n > 6000 && n < 60 * 60 * 24 * 1000) {
    return Math.round(n / 1000);
  }

  return Math.round(n);
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins + ':' + (secs < 10 ? '0' + secs : secs);
}

function pickDuration(item) {
  const base = item && (item.duration || item.lengthSeconds || item.seconds);
  const s = normalizeDurationSeconds(base);
  if (!s) return '';
  return formatTime(s);
}

function pickRelativeOrAbsoluteUrl(serverUrl, raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) {
    return text;
  }

  const base = (serverUrl || '').replace(/\/$/, '');
  if (!base) return text;

  if (text.startsWith('/')) {
    return base + text;
  }

  return base + '/' + text;
}

function pickThumbnailUrl(serverUrl, item, type) {
  const fromItem =
    item &&
    (item.thumbnail || item.thumb || item.poster || item.preview || item.albumArt || '');

  const direct = pickRelativeOrAbsoluteUrl(serverUrl, fromItem);
  if (direct) return direct;

  const id = getItemId(item);
  if (id == null) return '';

  const base = (serverUrl || '').replace(/\/$/, '');
  if (!base) return '';

  const kind = type === 'VIDEO' ? 'video' : 'image';
  return base + '/thumbnail/' + kind + '/' + encodeURIComponent(id);
}

function pickSourceUrl(serverUrl, item, type) {
  const id = getItemId(item);
  const base = (serverUrl || '').replace(/\/$/, '');

  // Video playback should always use the canonical stream endpoint.
  if (type === 'VIDEO' && base && id != null) {
    return base + '/media/video/' + encodeURIComponent(id);
  }

  const directRaw =
    item &&
    (item.url ||
      item.streamUrl ||
      item.fileUrl ||
      item.location ||
      item.path ||
      item.filePath ||
      item.fullPath ||
      '');

  const direct = pickRelativeOrAbsoluteUrl(serverUrl, directRaw);
  if (direct) return direct;

  if (id == null) return '';
  if (!base) return '';

  const kind = type === 'VIDEO' ? 'video' : 'image';
  return base + '/media/' + kind + '/' + encodeURIComponent(id);
}

function filterItems(items, query) {
  if (!query) return items;
  const q = String(query).trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const fields = [
      pickTitle(item),
      item && (item.fileName || item.filename || item.name || ''),
    ];
    return fields
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  });
}

function sortItems(items, sortKey, isSortReversed) {
  const arr = (items || []).slice();

  arr.sort((a, b) => {
    if (sortKey === 'name') {
      const an = pickTitle(a).toLowerCase();
      const bn = pickTitle(b).toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    }

    const ad = pickDateValue(a);
    const bd = pickDateValue(b);
    return ad - bd;
  });

  if (isSortReversed) arr.reverse();
  return arr;
}

export default function VisualMediaPage({
  serverUrl,
  onChangeServer,
  onNavigate,
  mediaType,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState('date');
  const [isSortReversed, setIsSortReversed] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [shouldAutoPlaySelectedVideo, setShouldAutoPlaySelectedVideo] = useState(false);

  const videoRef = useRef(null);

  const isVideoMode = mediaType === 'VIDEO';
  const pageTitle = isVideoMode ? 'My Videos' : 'My Photos';
  const emptyText = isVideoMode
    ? 'No videos found on this server.'
    : 'No photos found on this server.';

  useEffect(() => {
    if (!serverUrl) return;

    setLoading(true);
    setError('');

    const endpoint = getMediaEndpoint(serverUrl);

    let cancelled = false;

    fetchMediaItemsCached(serverUrl)
      .then((rawItems) => {
        if (cancelled) return;

        const nextItems = rawItems
          .map((item, index) => ({ ...item, __index: index }))
          .filter((item) => getMediaType(item) === mediaType);

        setItems(nextItems);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setError(
          'Could not load media from ' +
            endpoint +
            '. Make sure LocalStream is running and CORS is enabled.'
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [serverUrl, mediaType]);

  useEffect(() => {
    if (!serverUrl) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, serverUrl);
    } catch {
      // ignore
    }
  }, [serverUrl]);

  const filtered = useMemo(() => filterItems(items, searchQuery), [items, searchQuery]);
  const sorted = useMemo(
    () => sortItems(filtered, sortKey, isSortReversed),
    [filtered, sortKey, isSortReversed]
  );

  const selectedVideo = useMemo(() => {
    if (!isVideoMode || !items.length || selectedVideoId == null) return null;
    const found = items.find((item) => getItemId(item) === selectedVideoId);
    return found || null;
  }, [isVideoMode, items, selectedVideoId]);

  const selectedVideoSource = useMemo(
    () => (selectedVideo ? pickSourceUrl(serverUrl, selectedVideo, 'VIDEO') : ''),
    [serverUrl, selectedVideo]
  );

  const selectedVideoPoster = useMemo(
    () => (selectedVideo ? pickThumbnailUrl(serverUrl, selectedVideo, 'VIDEO') : ''),
    [serverUrl, selectedVideo]
  );

  useEffect(() => {
    if (!isVideoMode) {
      setSelectedVideoId(null);
      setShouldAutoPlaySelectedVideo(false);
      return;
    }

    if (!items.length) {
      setSelectedVideoId(null);
      setShouldAutoPlaySelectedVideo(false);
      return;
    }

    const exists =
      selectedVideoId != null &&
      items.some((item) => getItemId(item) === selectedVideoId);

    if (!exists) {
      setSelectedVideoId(null);
      setShouldAutoPlaySelectedVideo(false);
    }
  }, [isVideoMode, items, selectedVideoId]);

  useEffect(() => {
    if (!shouldAutoPlaySelectedVideo) return;
    const video = videoRef.current;
    if (!video) return;
    video
      .play()
      .catch(() => {
        // Browser autoplay may fail without gesture.
      });
    setShouldAutoPlaySelectedVideo(false);
  }, [shouldAutoPlaySelectedVideo, selectedVideoSource]);

  function handlePlayVideo(item) {
    const id = getItemId(item);
    setSelectedVideoId(id);
    setShouldAutoPlaySelectedVideo(true);
  }

  function skipVideoRelative(deltaSeconds) {
    const video = videoRef.current;
    if (!video) return;
    const newTime = Math.max(0, video.currentTime + deltaSeconds);
    video.currentTime = newTime;
  }

  function goToPreviousVideo() {
    if (!sorted.length || selectedVideoId == null) return;
    const currentIdx = sorted.findIndex((item) => getItemId(item) === selectedVideoId);
    if (currentIdx <= 0) return;
    handlePlayVideo(sorted[currentIdx - 1]);
  }

  function goToNextVideo() {
    if (!sorted.length || selectedVideoId == null) return;
    const currentIdx = sorted.findIndex((item) => getItemId(item) === selectedVideoId);
    if (currentIdx < 0 || currentIdx >= sorted.length - 1) return;
    handlePlayVideo(sorted[currentIdx + 1]);
  }

  return (
    <>
      <header className="top-bar">
        <div className="top-bar-left">
          <h1>{pageTitle}</h1>
          {serverUrl && (
            <a
              id="server-label"
              className="server-label"
              href={serverUrl}
              target="_blank"
              rel="noreferrer"
            >
              {`Connected to ${serverUrl}`}
            </a>
          )}
        </div>
        <div className="top-bar-right">
          <div className="media-nav" role="tablist" aria-label="Media sections">
            <button
              type="button"
              className="secondary"
              onClick={() => onNavigate('/media')}
            >
              Music
            </button>
            <button
              type="button"
              className={isVideoMode ? 'secondary media-nav-active' : 'secondary'}
              onClick={() => onNavigate('/media/video')}
            >
              Video
            </button>
            <button
              type="button"
              className={!isVideoMode ? 'secondary media-nav-active' : 'secondary'}
              onClick={() => onNavigate('/media/photo')}
            >
              Photo
            </button>
          </div>
          <button
            id="change-server"
            className="secondary"
            type="button"
            onClick={onChangeServer}
          >
            Change Server
          </button>
        </div>
      </header>

      <main className="page">
        <section className="card full">
          {loading && <div className="info">Loading media from LocalStream...</div>}
          {error && !loading && <div className="error">{error}</div>}
          {!loading && !error && sorted.length === 0 && (
            <div className="info">{emptyText}</div>
          )}

          <div className="toolbar-row">
            <div className="search-row">
              <input
                type="search"
                placeholder={isVideoMode ? 'Search videos...' : 'Search photos...'}
                aria-label="Search media"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="sort-row">
              <label htmlFor="visual-sort-select" className="sort-label">
                Sort by
              </label>
              <select
                id="visual-sort-select"
                aria-label="Sort media list"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value || 'date')}
              >
                <option value="date">Date</option>
                <option value="name">Name</option>
              </select>
              <button
                type="button"
                className="icon-button sort-icon-button"
                aria-label="Reverse current order"
                onClick={() => setIsSortReversed((v) => !v)}
              >
                ⇅
              </button>
            </div>
          </div>

          {isVideoMode ? (
            <>
              <section className="video-top-player" hidden={!selectedVideo}>
                {selectedVideo && (
                  <>
                    <video
                      ref={videoRef}
                      key={selectedVideoSource}
                      controls
                      preload="metadata"
                      poster={selectedVideoPoster || undefined}
                    >
                      <source src={selectedVideoSource} />
                    </video>
                    <div className="video-top-meta">
                      <div className="video-top-title" title={pickTitle(selectedVideo)}>
                        {pickTitle(selectedVideo)}
                      </div>
                      <div className="video-controls" aria-label="Video playback controls">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Previous video"
                          onClick={goToPreviousVideo}
                        >
                          <SkipBack size={18} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Rewind 10 seconds"
                          onClick={() => skipVideoRelative(-10)}
                        >
                          <Rewind size={18} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Fast forward 10 seconds"
                          onClick={() => skipVideoRelative(10)}
                        >
                          <FastForward size={18} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Next video"
                          onClick={goToNextVideo}
                        >
                          <SkipForward size={18} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </section>

              <ul className="music-list" aria-label="Video list">
                {sorted.map((item) => {
                  const key = String(getItemId(item) ?? item.__index ?? pickTitle(item));
                  const title = pickTitle(item);
                  const thumbUrl = pickThumbnailUrl(serverUrl, item, 'VIDEO');
                  const isActive =
                    !!selectedVideo && getItemId(selectedVideo) === getItemId(item);

                  return (
                    <li className="music-item" key={key}>
                      <div className="music-art">
                        <img
                          src={thumbUrl}
                          alt={title}
                          onError={(event) => {
                            const img = event.currentTarget;
                            if (img.dataset.fallbackApplied === 'true') return;
                            img.dataset.fallbackApplied = 'true';
                            img.src = '/default-art.png';
                          }}
                        />
                      </div>
                      <div className="music-main">
                        <div className={'music-title' + (isActive ? ' playing-title' : '')}>{title}</div>
                        <div className="music-meta">{pickDuration(item)}</div>
                      </div>
                      <div className="music-actions">
                        <button
                          type="button"
                          className={isActive ? 'playing' : ''}
                          aria-label={isActive ? 'Playing' : 'Play'}
                          onClick={() => handlePlayVideo(item)}
                        >
                          {isActive ? (
                            <AudioLines size={18} />
                          ) : (
                            <Play size={18} fill="currentColor" stroke="none" />
                          )}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="visual-grid" aria-label="Photo gallery">
              {sorted.map((item) => {
                const key = String(getItemId(item) ?? item.__index ?? pickTitle(item));
                const title = pickTitle(item);
                const sourceUrl = pickSourceUrl(serverUrl, item, mediaType);
                const thumbUrl = pickThumbnailUrl(serverUrl, item, mediaType);

                return (
                  <article key={key} className="visual-card visual-image-card">
                    <a href={sourceUrl || thumbUrl} target="_blank" rel="noreferrer">
                      <img
                        src={thumbUrl || sourceUrl}
                        alt={title}
                        loading="lazy"
                        onError={(event) => {
                          const img = event.currentTarget;
                          const fallback = sourceUrl || thumbUrl;
                          if (img.dataset.fallbackApplied === 'true' || !fallback) return;
                          img.dataset.fallbackApplied = 'true';
                          img.src = fallback;
                        }}
                      />
                    </a>
                    <div className="visual-meta">
                      <div className="visual-title" title={title}>{title}</div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
