import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Shuffle, Repeat, SkipBack, SkipForward, Play, AudioLines, Pause, Rewind, FastForward, ChevronUp, ChevronDown } from 'lucide-react';
import defaultArt from '/default-art.png';

const STORAGE_KEY = 'localstream_server_url';

function pickTitle(item) {
  if (!item) return 'Unknown title';
  const raw = item.title || item.name || item.fileName || item.filename || '';
  const text = String(raw).trim();
  return text || 'Unknown title';
}

function pickArtist(item) {
  return (
    (item && (item.artist || item.albumArtist || item.album)) ||
    ''
  );
}

function normalizeDurationSeconds(raw) {
  if (raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;

  // Many libraries report duration in milliseconds; if the value is
  // very large (but still within a day in ms), treat it as ms.
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

function pickDurationSeconds(item) {
  const base = item && (item.duration || item.lengthSeconds || item.seconds);
  return normalizeDurationSeconds(base);
}

function isWavFile(item) {
  const candidates = [
    item && item.fileName,
    item && item.filename,
    item && item.name,
    item && item.title,
    item && item.path,
    item && item.filePath,
    item && item.location,
    item && item.url,
  ];

  return candidates.some((value) => {
    if (!value || typeof value !== 'string') return false;
    return /\.wav$/i.test(value.trim());
  });
}

function pickFolderName(item) {
  const direct =
    item.folder ||
    item.folderName ||
    item.container ||
    item.parent ||
    item.parentTitle ||
    '';
  if (direct) return String(direct);

  const path =
    item.path ||
    item.filePath ||
    item.filepath ||
    item.fullPath ||
    item.location ||
    '';

  if (path) {
    const parts = String(path).split(/[\\/]+/).filter(Boolean);
    if (parts.length > 1) {
      return parts[parts.length - 2];
    }
  }

  return 'Unknown folder';
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

function getItemId(item) {
  if (!item) return null;
  const id = item.id ?? item.mediaId ?? item.audioId;
  return id != null ? id : null;
}

function getItemDomKey(item) {
  if (!item) return '';
  const id = getItemId(item);
  if (id != null) return String(id);
  if (typeof item.__index === 'number') return 'i-' + item.__index;
  return '';
}

function pickStreamUrl(serverUrl, item) {
  const id = getItemId(item);
  if (!id && id !== 0) return '';
  const base = serverUrl.replace(/\/$/, '');
  return base + '/media/audio/' + encodeURIComponent(id);
}

function pickThumbnailUrl(serverUrl, item) {
  // Prefer item-specific thumbnail, then album art; fall back to
  // the default image served from this app's public folder.
  if (!item) return defaultArt;

  // If this specific album art path is present, always use the
  // default image instead of that artwork.
  if (item.albumArt === '/thumbnail/album/3579481289389474209') {
    return defaultArt;
  }

  // Only use album art (server thumbnails are not reliable).
  const raw = item.albumArt || '';
  const str = String(raw).trim();

  if (!str) {
    return defaultArt;
  }

  // If it's a fully-qualified URL or URI (http, https, content, file,
  // data, blob, etc.), just return it as-is.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(str)) {
    return str;
  }

  // If it's explicitly our default art, also return as-is.
  if (str === defaultArt) {
    return defaultArt;
  }

  const base = (serverUrl || '').replace(/\/$/, '');

  // If we don't have a server URL, fall back to the raw string.
  if (!base) {
    return str;
  }

  // If it's an absolute path on the LocalStream server, prefix it
  // with the base URL.
  if (str.startsWith('/')) {
    return base + str;
  }

  // Otherwise treat it as a relative path on the LocalStream server.
  return base + '/' + str;
}

function filterItems(allItems, query) {
  if (!query) return allItems;
  const q = String(query).trim().toLowerCase();
  if (!q) return allItems;

  return allItems.filter((item) => {
    const fields = [
      pickTitle(item),
      pickArtist(item),
      pickFolderName(item),
      item && (item.fileName || item.filename || item.name || ''),
    ];
    const haystack = fields
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

function sortItems(items, sortKey, isSortReversed) {
  if (!items || !items.length) return [];
  const arr = items.slice();

  arr.sort((a, b) => {
    if (sortKey === 'name') {
      const an = pickTitle(a).toLowerCase();
      const bn = pickTitle(b).toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    }
    if (sortKey === 'date') {
      const ad = pickDateValue(a);
      const bd = pickDateValue(b);
      return ad - bd;
    }
    if (sortKey === 'duration') {
      const ad = pickDurationSeconds(a);
      const bd = pickDurationSeconds(b);
      return ad - bd;
    }
    const ai = typeof a.__index === 'number' ? a.__index : 0;
    const bi = typeof b.__index === 'number' ? b.__index : 0;
    return ai - bi;
  });

  if (isSortReversed) arr.reverse();
  return arr;
}

export default function MediaPage({ serverUrl, onChangeServer }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [allItems, setAllItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState('original');
  const [isSortReversed, setIsSortReversed] = useState(false);
  // Index of the item in the original, unsorted list (items have a stable
  // `__index` we keep here so re-sorting doesn't change the playing track).
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentDuration, setCurrentDuration] = useState(0);

  const audioRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (!serverUrl) return;

    setLoading(true);
    setError('');

    const base = serverUrl.replace(/\/$/, '');
    const endpoint = base + '/api/media';

    let cancelled = false;

    fetch(endpoint, {
      headers: { Accept: 'application/json' },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Server responded with ' + response.status);
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        const rawItems = Array.isArray(data)
          ? data
          : data.items || data.files || data.tracks || data.audio || [];

        const items = rawItems
          .map((item, index) => ({ ...item, __index: index }))
          .filter((item) => {
            const t =
              (item && (item.type || item.mediaType || item.kind || '')) || '';
            const isAudio = String(t).toUpperCase() === 'AUDIO';
            if (!isAudio) return false;
            const albumNameRaw =
              item &&
              (item.album ||
                item.albumTitle ||
                item.album_name ||
                item.albumName ||
                '');
            const albumName = String(albumNameRaw).trim().toLowerCase();
            if (albumName) {
              const blockedAlbums = ['alams', 'alarms', 'ringtones', 'notifications'];
              if (blockedAlbums.includes(albumName)) {
                return false;
              }
            }
            return !isWavFile(item);
          });

        setAllItems(items);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setError(
          'Could not load music from ' +
          endpoint +
          '. Make sure LocalStream is running and CORS is enabled.'
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  useEffect(() => {
    if (!serverUrl) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, serverUrl);
    } catch {
      // ignore
    }
  }, [serverUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.loop = isRepeat;
  }, [isRepeat]);

  // Full playlist: all items, sorted but not filtered by search.
  const sortedAllItems = useMemo(
    () => sortItems(allItems, sortKey, isSortReversed),
    [allItems, sortKey, isSortReversed]
  );

  // Visible list: apply search filter on top of the sorted full list.
  const filteredItems = useMemo(
    () => filterItems(sortedAllItems, searchQuery),
    [sortedAllItems, searchQuery]
  );

  useEffect(() => {
    if (sortedAllItems.length === 0) {
      setCurrentIndex(-1);
      setIsPlaying(false);
      setCurrentTime(0);
      setCurrentDuration(0);
    }
  }, [sortedAllItems.length]);

  // Play by index within the full sorted playlist.
  function handlePlay(index) {
    if (!audioRef.current || index < 0 || index >= sortedAllItems.length) return;
    const item = sortedAllItems[index];
    const url = pickStreamUrl(serverUrl, item);
    if (!url) {
      setError('This item does not have a playable URL.');
      return;
    }
    setError('');
    const audio = audioRef.current;
    audio.src = url;
    audio
      .play()
      .catch((err) => {
        console.error(err);
        setError('Unable to start playback in this browser.');
      });
    // Store the item's original index so that changing the sort order does
    // not change which track is considered "current".
    const originalIndex =
      typeof item.__index === 'number' ? item.__index : index;
    setCurrentIndex(originalIndex);
    setIsPlaying(true);
    setCurrentTime(0);
  }

  function getCurrentPlaylistIndex() {
    if (currentIndex < 0) return -1;
    return sortedAllItems.findIndex((item) =>
      typeof item.__index === 'number'
        ? item.__index === currentIndex
        : false
    );
  }

  function getNextIndex() {
    const n = sortedAllItems.length;
    if (!n) return -1;
    const playlistIndex = getCurrentPlaylistIndex();
    if (isShuffle && n > 1) {
      let next = playlistIndex >= 0 ? playlistIndex : 0;
      for (let i = 0; i < 5 && next === playlistIndex; i += 1) {
        next = Math.floor(Math.random() * n);
      }
      return next;
    }
    if (playlistIndex < 0) return 0;
    return (playlistIndex + 1) % n;
  }

  function getPrevIndex() {
    const n = sortedAllItems.length;
    if (!n) return -1;
    const playlistIndex = getCurrentPlaylistIndex();
    if (isShuffle && n > 1) {
      let prev = playlistIndex >= 0 ? playlistIndex : 0;
      for (let i = 0; i < 5 && prev === playlistIndex; i += 1) {
        prev = Math.floor(Math.random() * n);
      }
      return prev;
    }
    if (playlistIndex < 0) return n - 1;
    return (playlistIndex - 1 + n) % n;
  }

  function handleEnded() {
    if (isRepeat) {
      // audio.loop handles repeating current track
      return;
    }
    const idx = getNextIndex();
    if (idx >= 0) {
      handlePlay(idx);
    }
  }

  const hasItems = sortedAllItems.length > 0;

  // Group only the currently visible (filtered) items for display by folder.
  const groups = useMemo(() => {
    const map = {};
    filteredItems.forEach((item) => {
      const folder = pickFolderName(item) || 'Other';
      if (!map[folder]) map[folder] = [];
      map[folder].push(item);
    });
    return map;
  }, [filteredItems]);

  const groupKeys = useMemo(
    () =>
      Object.keys(groups).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      ),
    [groups]
  );

  const currentlyPlaying = useMemo(() => {
    if (currentIndex < 0) return null;
    const found = sortedAllItems.find((item) =>
      typeof item.__index === 'number' ? item.__index === currentIndex : false
    );
    return found || null;
  }, [sortedAllItems, currentIndex]);

  const currentArtUrl = currentlyPlaying
    ? pickThumbnailUrl(serverUrl, currentlyPlaying)
    : defaultArt;

  useEffect(() => {
    if (!currentlyPlaying) {
      setCurrentTime(0);
      setCurrentDuration(0);
      setIsPlaying(false);
      return;
    }
    const metaDuration = pickDurationSeconds(currentlyPlaying);
    setCurrentDuration(metaDuration || 0);
  }, [currentlyPlaying]);

  // When clicking a song from the (possibly filtered) list, map it
  // back to its index in the full playlist and play from there.
  function handlePlayForItem(item) {
    if (!audioRef.current || !item) return;
    const targetId = getItemId(item);
    let playlistIndex = -1;

    if (targetId != null) {
      playlistIndex = sortedAllItems.findIndex(
        (p) => getItemId(p) === targetId
      );
    } else {
      playlistIndex = sortedAllItems.indexOf(item);
    }

    if (playlistIndex >= 0) {
      handlePlay(playlistIndex);
    }
  }

  function scrollToCurrent() {
    if (!currentlyPlaying) return;
    const domKey = getItemDomKey(currentlyPlaying);
    if (!domKey) return;
    const el = document.querySelector('[data-track-key="' + domKey + '"]');
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function togglePlayPause() {
    const audio = audioRef.current;
    if (!audio) return;

    if (!currentlyPlaying) {
      if (sortedAllItems.length === 0) return;
      handlePlay(0);
      return;
    }

    if (audio.paused) {
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => {
          console.error(err);
          setError('Unable to start playback in this browser.');
        });
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime || 0);
  }

  function handleLoadedMetadata() {
    const audio = audioRef.current;
    if (!audio) return;
    if (Number.isFinite(audio.duration)) {
      setCurrentDuration(Math.floor(audio.duration));
    }
  }

  function handleSeek(event) {
    const audio = audioRef.current;
    if (!audio) return;
    const value = Number(event.target.value) || 0;
    audio.currentTime = value;
    setCurrentTime(value);
  }

  function skipRelative(deltaSeconds) {
    const audio = audioRef.current;
    if (!audio) return;

    const duration = Number.isFinite(audio.duration)
      ? audio.duration
      : currentDuration || (currentlyPlaying ? pickDurationSeconds(currentlyPlaying) : 0) || 0;

    const rawTime = (audio.currentTime || 0) + deltaSeconds;
    const clampedTime = duration
      ? Math.max(0, Math.min(rawTime, duration))
      : Math.max(0, rawTime);

    audio.currentTime = clampedTime;
    setCurrentTime(clampedTime);
  }

  function scrollListToTop() {
    const list = document.getElementById('music-list');
    if (!list) return;
    if (typeof list.scrollTo === 'function') {
      list.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      list.scrollTop = 0;
    }
  }

  function scrollListToBottom() {
    const list = document.getElementById('music-list');
    if (!list) return;
    const max = list.scrollHeight || 0;
    if (typeof list.scrollTo === 'function') {
      list.scrollTo({ top: max, behavior: 'smooth' });
    } else {
      list.scrollTop = max;
    }
  }

  useEffect(() => {
    function handleKeyDown(event) {
      if (!sortedAllItems.length) return;

      const active = document.activeElement;
      if (searchInputRef.current && active === searchInputRef.current) {
        return;
      }

      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const key = event.key;

      if (key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        togglePlayPause();
        return;
      }

      const lower = typeof key === 'string' ? key.toLowerCase() : '';

      if (lower === 'c') {
        event.preventDefault();
        const idx = getPrevIndex();
        if (idx >= 0) handlePlay(idx);
        return;
      }

      if (lower === 'm') {
        event.preventDefault();
        const idx = getNextIndex();
        if (idx >= 0) handlePlay(idx);
        return;
      }

      if (lower === 'v') {
        event.preventDefault();
        skipRelative(-10);
        return;
      }

      if (lower === 'n') {
        event.preventDefault();
        skipRelative(10);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sortedAllItems.length, togglePlayPause, getPrevIndex, getNextIndex, skipRelative]);

  return (
    <>
      <header className="top-bar">
        <div className="top-bar-left">
          <h1>My Music</h1>
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
          {loading && (
            <div id="loading" className="info">
              Loading music from LocalStream…
            </div>
          )}
          {error && !loading && (
            <div id="error" className="error">
              {error}
            </div>
          )}
          {!loading && !error && !hasItems && (
            <div id="empty" className="info">
              No music found on this server.
            </div>
          )}

          <div className="toolbar-row">
            <div className="search-row">
              <input
                id="search-input"
                type="search"
                placeholder="Search by title, artist, or folder…"
                aria-label="Search music"
                value={searchQuery}
                ref={searchInputRef}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="sort-row">
              <label htmlFor="sort-select" className="sort-label">
                Sort by
              </label>
              <select
                id="sort-select"
                aria-label="Sort music list"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value || '')}
              >
                <option value="date">Date</option>
                <option value="name">Name</option>
                <option value="duration">Duration</option>
              </select>
              <button
                id="sort-reverse"
                type="button"
                className="secondary"
                aria-label="Reverse current order"
                onClick={() => setIsSortReversed((v) => !v)}
              >
                ⇅
              </button>
            </div>
          </div>

          <div className="music-list-shell">
            <ul id="music-list" className="music-list">
              {groupKeys.map((groupKey) => (
                <React.Fragment key={groupKey}>
                  <li className="folder-header">{groupKey}</li>
                  {groups[groupKey].map((item) => {
                  const isActive =
                    !!currentlyPlaying &&
                    (currentlyPlaying === item ||
                      (getItemId(currentlyPlaying) != null &&
                        getItemId(currentlyPlaying) === getItemId(item)));
                  const artUrl = pickThumbnailUrl(serverUrl, item);
                  const domKey = getItemDomKey(item);
                  return (
                    <li
                      className="music-item"
                      key={domKey || (getItemId(item) ?? item.__index)}
                      data-track-key={domKey}
                    >
                      <div className="music-art">
                        <img
                          src={artUrl}
                          alt={pickTitle(item)}
                          onError={(event) => {
                            const img = event.currentTarget;
                            if (img.dataset.fallbackApplied === 'true') return;
                            img.dataset.fallbackApplied = 'true';
                            img.src = defaultArt;
                          }}
                        />
                      </div>
                      <div className="music-main">
                        <div
                          className={
                            'music-title' + (isActive ? ' playing-title' : '')
                          }
                        >
                          {pickTitle(item)}
                        </div>
                        <div className="music-artist">{pickArtist(item)}</div>
                        <div className="music-meta">{pickDuration(item)}</div>
                      </div>
                      <div className="music-actions">
                        <button
                          type="button"
                          className={isActive ? 'playing' : ''}
                          aria-label={isActive ? 'Playing' : 'Play'}
                          onClick={() => handlePlayForItem(item)}
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
                </React.Fragment>
              ))}
            </ul>
            <div className="music-side-rail">
              <button
                type="button"
                className="scroll-edge-button"
                aria-label="Scroll to top of list"
                onClick={scrollListToTop}
                disabled={!hasItems}
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                className="scroll-edge-button"
                aria-label="Scroll to bottom of list"
                onClick={scrollListToBottom}
                disabled={!hasItems}
              >
                <ChevronDown size={16} />
              </button>
            </div>
          </div>

          <footer className="player" id="player" hidden={!currentlyPlaying}>
            {currentlyPlaying && (
              <div
                className="player-background"
                style={{ backgroundImage: `url(${currentArtUrl})` }}
              />
            )}
            <div className="player-overlay" />
            <div className="player-content">
              <div className="player-main">
                {currentlyPlaying && (
                  <div className="player-art">
                    <img
                      src={currentArtUrl}
                      alt={pickTitle(currentlyPlaying)}
                      onError={(event) => {
                        const img = event.currentTarget;
                        if (img.dataset.fallbackApplied === 'true') return;
                        img.dataset.fallbackApplied = 'true';
                        img.src = defaultArt;
                      }}
                    />
                  </div>
                )}
                <div className="player-info">
                  <div id="current-title" className="player-title">
                    <button
                      type="button"
                      className="player-title-button"
                      onClick={scrollToCurrent}
                    >
                      {currentlyPlaying ? pickTitle(currentlyPlaying) : ''}
                    </button>
                  </div>
                  <div id="current-artist" className="player-artist">
                    {currentlyPlaying ? pickArtist(currentlyPlaying) : ''}
                  </div>
                </div>
              </div>
              <div className="player-timeline" aria-label="Playback timeline">
                <span className="player-time">{formatTime(currentTime)}</span>
                <input
                  type="range"
                  min="0"
                  max={currentDuration || (currentlyPlaying ? pickDurationSeconds(currentlyPlaying) : 0) || 0}
                  step="1"
                  value={Math.min(currentTime, currentDuration || Number.MAX_SAFE_INTEGER)}
                  onChange={handleSeek}
                />
                <span className="player-time">{formatTime(currentDuration || pickDurationSeconds(currentlyPlaying))}</span>
              </div>
              <div className="player-controls" aria-label="Playback controls">
              <button
              id="repeat-toggle"
              type="button"
              className={`icon-button ${isRepeat ? 'toggle-active' : ''}`}
              aria-label="Toggle repeat"
              aria-pressed={isRepeat ? 'true' : 'false'}
              onClick={() => setIsRepeat((v) => !v)}
            >
              <Repeat size={18} />
            </button>
              <button
                id="prev-track"
                type="button"
                className="icon-button"
                aria-label="Previous track"
                onClick={() => {
                  const idx = getPrevIndex();
                  if (idx >= 0) handlePlay(idx);
                }}
              >
                <SkipBack size={18} />
              </button>
              <button
                id="rewind-10"
                type="button"
                className="icon-button"
                aria-label="Rewind 10 seconds"
                onClick={() => skipRelative(-10)}
              >
                <Rewind size={18} />
              </button>
              <button
                id="play-pause"
                type="button"
                className="icon-button play-main"
                aria-label={isPlaying ? 'Pause' : 'Play'}
                aria-pressed={isPlaying ? 'true' : 'false'}
                onClick={togglePlayPause}
              >
                {isPlaying ? (
                  <Pause size={20} fill="currentColor" stroke="none"/>
                ) : (
                  <Play size={20} fill="currentColor" stroke="none" />
                )}
              </button>
              
              <button
                id="forward-10"
                type="button"
                className="icon-button"
                aria-label="Fast forward 10 seconds"
                onClick={() => skipRelative(10)}
              >
                <FastForward size={18} />
              </button>
              <button
                id="next-track"
                type="button"
                className="icon-button"
                aria-label="Next track"
                onClick={() => {
                  const idx = getNextIndex();
                  if (idx >= 0) handlePlay(idx);
                }}
              >
                <SkipForward size={18} />
              </button>
              <button
                id="shuffle-toggle"
                type="button"
                className={`icon-button ${isShuffle ? 'toggle-active' : ''}`}
                aria-label="Toggle shuffle"
                aria-pressed={isShuffle ? 'true' : 'false'}
                onClick={() => setIsShuffle((v) => !v)}
              >
                <Shuffle size={18} />
              </button>

              </div>
            </div>
            <audio
              id="audio"
              ref={audioRef}
              preload="none"
              onEnded={handleEnded}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              style={{ display: 'none' }}
            />
          </footer>
        </section>
      </main>
    </>
  );
}
