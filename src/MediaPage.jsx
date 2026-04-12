import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Shuffle, Repeat, SkipBack, SkipForward, Play, AudioLines, Pause, Rewind, FastForward, ChevronUp, ChevronDown, Folder } from 'lucide-react';
import defaultArt from '/default-art.png';
import { fetchMediaItemsCached, getMediaEndpoint } from './mediaApiCache.js';

const STORAGE_KEY = 'localstream_server_url';
const SETTINGS_KEY = 'localstream_settings';

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Ensure hiddenFolders is always an array
      if (!Array.isArray(parsed.hiddenFolders)) {
        parsed.hiddenFolders = [];
      }
      return parsed;
    }
  } catch {
    // ignore
  }
  return {
    hiddenFolders: []
  };
}

function saveSettings(patch) {
  try {
    const existing = loadSettings();
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...existing, ...patch }));
  } catch {
    // ignore
  }
}

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
  let url = base + '/media/audio/' + encodeURIComponent(id);
  return url;
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
  let url;
  if (str.startsWith('/')) {
    url = base + str;
  } else {
    // Otherwise treat it as a relative path on the LocalStream server.
    url = base + '/' + str;
  }

  return url;
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

function reorderByFolder(items) {
  if (!items || !items.length) return [];

  const groups = {};
  items.forEach((item) => {
    const folder = pickFolderName(item) || 'Other';
    if (!groups[folder]) groups[folder] = [];
    groups[folder].push(item);
  });

  const folderNames = Object.keys(groups).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  const ordered = [];
  folderNames.forEach((folder) => {
    ordered.push(...groups[folder]);
  });

  return ordered;
}

export default function MediaPage({ serverUrl, onChangeServer, onNavigate }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [allItems, setAllItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState(() => loadSettings().searchQuery ?? '');
  const [sortKey, setSortKey] = useState(() => loadSettings().sortKey ?? 'original');
  const [isSortReversed, setIsSortReversed] = useState(() => loadSettings().isSortReversed ?? false);
  const [groupByFolder, setGroupByFolder] = useState(() => loadSettings().groupByFolder ?? true);
  const [hiddenFolders, setHiddenFolders] = useState(() => loadSettings().hiddenFolders ?? []);
  // Index of the item in the original, unsorted list (items have a stable
  // `__index` we keep here so re-sorting doesn't change the playing track).
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isShuffle, setIsShuffle] = useState(() => loadSettings().isShuffle ?? false);
  const [isRepeat, setIsRepeat] = useState(() => loadSettings().isRepeat ?? false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentDuration, setCurrentDuration] = useState(0);

  const audioRef = useRef(null);
  const searchInputRef = useRef(null);
  const musicListRef = useRef(null);
  const scrollTrackRef = useRef(null);
  const [isDraggingThumb, setIsDraggingThumb] = useState(false);
  const dragStartY = useRef(0);
  const dragStartScrollTop = useRef(0);

  const updateScrollbar = useCallback(() => {
    const list = musicListRef.current;
    const track = scrollTrackRef.current;
    if (!list || !track) return;

    const scrollHeight = list.scrollHeight;
    const clientHeight = list.clientHeight;
    const scrollTop = list.scrollTop;

    if (scrollHeight <= clientHeight + 1) {
      track.style.opacity = '0';
      track.style.pointerEvents = 'none';
      return;
    }

    track.style.opacity = '1';
    track.style.pointerEvents = 'auto';
    const thumbHeight = Math.max((clientHeight / scrollHeight) * 100, 10);
    const thumbTop = (scrollTop / (scrollHeight - clientHeight)) * (100 - thumbHeight);

    list.parentElement.style.setProperty('--thumb-height', `${thumbHeight}%`);
    list.parentElement.style.setProperty('--thumb-top', `${thumbTop}%`);
  }, []);

  useEffect(() => {
    const list = musicListRef.current;
    if (list) {
      list.addEventListener('scroll', updateScrollbar);
      window.addEventListener('resize', updateScrollbar);
      const observer = new MutationObserver(updateScrollbar);
      observer.observe(list, { childList: true, subtree: true });
      updateScrollbar();
      return () => {
        list.removeEventListener('scroll', updateScrollbar);
        window.removeEventListener('resize', updateScrollbar);
        observer.disconnect();
      };
    }
  }, [updateScrollbar, allItems]);

  const handleThumbMouseMove = useCallback((e) => {
    const list = musicListRef.current;
    const track = scrollTrackRef.current;
    if (!list || !track || !dragStartY.current) return;

    const deltaY = e.clientY - dragStartY.current;
    const trackHeight = track.clientHeight;
    const scrollHeight = list.scrollHeight;
    const clientHeight = list.clientHeight;

    const scrollableHeight = scrollHeight - clientHeight;
    const actualThumbHeight = Math.max((clientHeight / scrollHeight) * trackHeight, trackHeight * 0.1);
    const scrollDelta = (deltaY / (trackHeight - actualThumbHeight)) * scrollableHeight;

    list.scrollTop = dragStartScrollTop.current + scrollDelta;
  }, []);

  const handleThumbMouseUp = useCallback(() => {
    setIsDraggingThumb(false);
    dragStartY.current = 0;
    document.removeEventListener('mousemove', handleThumbMouseMove);
    document.removeEventListener('mouseup', handleThumbMouseUp);
    document.body.style.userSelect = '';
  }, [handleThumbMouseMove]);

  const handleThumbMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingThumb(true);
    dragStartY.current = e.clientY;
    dragStartScrollTop.current = musicListRef.current.scrollTop;
    document.addEventListener('mousemove', handleThumbMouseMove);
    document.addEventListener('mouseup', handleThumbMouseUp);
    document.body.style.userSelect = 'none';
  };

  const handleTrackClick = (e) => {
    if (e.target === scrollTrackRef.current) {
        const list = musicListRef.current;
        const track = scrollTrackRef.current;
        const rect = track.getBoundingClientRect();
        const clickY = e.clientY - rect.top;
        const thumbHeightFactor = list.clientHeight / list.scrollHeight;
        const trackHeight = track.clientHeight;
        const thumbHeight = Math.max(trackHeight * thumbHeightFactor, trackHeight * 0.1);
        
        // Center the thumb on the click position
        const targetThumbTop = clickY - thumbHeight / 2;
        const scrollPercent = Math.max(0, Math.min(1, targetThumbTop / (trackHeight - thumbHeight)));
        list.scrollTop = (list.scrollHeight - list.clientHeight) * scrollPercent;
    }
  };

  useEffect(() => {
    if (!serverUrl) return;

    setLoading(true);
    setError('');

    const endpoint = getMediaEndpoint(serverUrl);

    let cancelled = false;

    fetchMediaItemsCached(serverUrl)
      .then((rawItems) => {
        if (cancelled) return;

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

  // Persist settings whenever they change.
  useEffect(() => { saveSettings({ sortKey }); }, [sortKey]);
  useEffect(() => { saveSettings({ isSortReversed }); }, [isSortReversed]);
  useEffect(() => { saveSettings({ groupByFolder }); }, [groupByFolder]);
  useEffect(() => { saveSettings({ isShuffle }); }, [isShuffle]);
  useEffect(() => { saveSettings({ isRepeat }); }, [isRepeat]);
  useEffect(() => { saveSettings({ hiddenFolders }); }, [hiddenFolders]);
  useEffect(() => { saveSettings({ searchQuery }); }, [searchQuery]);

  // Full playlist: all items, sorted but not filtered by search.
  const sortedAllItems = useMemo(
    () => sortItems(allItems, sortKey, isSortReversed),
    [allItems, sortKey, isSortReversed]
  );

  // Optionally reorder the sorted list by folder name so that
  // playback order matches the grouped visual order.
  const playlistItems = useMemo(
    () => (groupByFolder ? reorderByFolder(sortedAllItems) : sortedAllItems),
    [sortedAllItems, groupByFolder]
  );

  // Visible list: apply search filter on top of the sorted full list.
  const filteredItems = useMemo(
    () => filterItems(playlistItems, searchQuery),
    [playlistItems, searchQuery]
  );

  const hiddenFolderSet = useMemo(
    () => new Set(hiddenFolders || []),
    [hiddenFolders]
  );

  useEffect(() => {
    if (playlistItems.length === 0) {
      setCurrentIndex(-1);
      setIsPlaying(false);
      setCurrentTime(0);
      setCurrentDuration(0);
    }
  }, [playlistItems.length]);

  // Play by index within the full sorted playlist.
  function handlePlay(index) {
    if (!audioRef.current || index < 0 || index >= playlistItems.length) return;
    const item = playlistItems[index];
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
    return playlistItems.findIndex((item) =>
      typeof item.__index === 'number'
        ? item.__index === currentIndex
        : false
    );
  }

  function getNextIndex() {
    const n = playlistItems.length;
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
    const n = playlistItems.length;
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

  const hasItems = playlistItems.length > 0;

  // Group only the currently visible (filtered) items for display by folder
  // when the toggle is enabled.
  const groups = useMemo(() => {
    if (!groupByFolder) return {};
    const map = {};
    filteredItems.forEach((item) => {
      const folder = pickFolderName(item) || 'Other';
      if (!map[folder]) map[folder] = [];
      map[folder].push(item);
    });
    return map;
  }, [filteredItems, groupByFolder]);

  const groupKeys = useMemo(
    () =>
      groupByFolder
        ? Object.keys(groups).sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: 'base' })
          )
        : [],
    [groups, groupByFolder]
  );

  const currentlyPlaying = useMemo(() => {
    if (currentIndex < 0) return null;
    const found = playlistItems.find((item) =>
      typeof item.__index === 'number' ? item.__index === currentIndex : false
    );
    return found || null;
  }, [playlistItems, currentIndex]);

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

  // Keep the browser/OS media controls (Media Session API) in sync
  // with the current track's metadata and playback state.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }

    if (!currentlyPlaying) {
      try {
        navigator.mediaSession.metadata = null;
      } catch {
        // ignore
      }
      return;
    }

    const title = pickTitle(currentlyPlaying);
    const artist = pickArtist(currentlyPlaying);
    const album = pickFolderName(currentlyPlaying);

    try {
      const artwork = currentArtUrl
        ? [
            {
              src: currentArtUrl,
              sizes: '512x512',
            },
          ]
        : [];

      // eslint-disable-next-line no-undef
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork,
      });
    } catch {
      // Some browsers may not support MediaMetadata fully; fail silently.
    }
  }, [currentlyPlaying, currentArtUrl]);

  // When clicking a song from the (possibly filtered) list, map it
  // back to its index in the full playlist and play from there.
  function handlePlayForItem(item) {
    if (!audioRef.current || !item) return;
    const targetId = getItemId(item);
    let playlistIndex = -1;

    if (targetId != null) {
      playlistIndex = playlistItems.findIndex(
        (p) => getItemId(p) === targetId
      );
    } else {
      playlistIndex = playlistItems.indexOf(item);
    }

    if (playlistIndex >= 0) {
      handlePlay(playlistIndex);
    }
  }

  function scrollToCurrent() {
    if (!currentlyPlaying) return;

    function doScroll() {
      const domKey = getItemDomKey(currentlyPlaying);
      if (!domKey) return;
      const list = musicListRef.current;
      if (!list) return;
      const el = list.querySelector('[data-track-key="' + domKey + '"]');
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    if (groupByFolder) {
      const folderName = pickFolderName(currentlyPlaying) || 'Other';
      if (hiddenFolderSet.has(folderName)) {
        setHiddenFolders((prev) =>
          (Array.isArray(prev) ? prev : []).filter((name) => name !== folderName)
        );
        // Wait for React to render the now-visible items before scrolling.
        setTimeout(doScroll, 0);
        return;
      }
    }

    doScroll();
  }

  function togglePlayPause() {
    const audio = audioRef.current;
    if (!audio) return;

    if (!currentlyPlaying) {
      if (playlistItems.length === 0) return;
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
    const t = audio.currentTime || 0;
    setCurrentTime(t);

    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      const supportsPosition =
        typeof navigator.mediaSession.setPositionState === 'function';
      if (supportsPosition) {
        try {
          navigator.mediaSession.setPositionState({
            duration:
              Number.isFinite(audio.duration) && audio.duration > 0
                ? audio.duration
                : currentDuration || 0,
            playbackRate: audio.playbackRate || 1,
            position: t,
          });
        } catch {
          // ignore position errors
        }
      }
    }
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
  
  // Reflect play/pause state in the Media Session API.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch {
      // ignore
    }
  }, [isPlaying]);

  // Wire hardware/media key controls (play/pause, next, previous, seek).
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }

    const ms = navigator.mediaSession;

    const safeSet = (action, handler) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Some browsers may not support all actions.
      }
    };

    safeSet('play', () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.paused) {
        togglePlayPause();
      }
    });

    safeSet('pause', () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (!audio.paused) {
        togglePlayPause();
      }
    });

    safeSet('previoustrack', () => {
      const idx = getPrevIndex();
      if (idx >= 0) handlePlay(idx);
    });

    safeSet('nexttrack', () => {
      const idx = getNextIndex();
      if (idx >= 0) handlePlay(idx);
    });

    safeSet('seekbackward', (details) => {
      const delta = (details && details.seekOffset) || 10;
      skipRelative(-delta);
    });

    safeSet('seekforward', (details) => {
      const delta = (details && details.seekOffset) || 10;
      skipRelative(delta);
    });

    safeSet('seekto', (details) => {
      if (!details || typeof details.seekTime !== 'number') return;
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = details.seekTime;
      setCurrentTime(details.seekTime);
    });

    return () => {
      const actions = [
        'play',
        'pause',
        'previoustrack',
        'nexttrack',
        'seekbackward',
        'seekforward',
        'seekto',
      ];
      actions.forEach((action) => {
        try {
          ms.setActionHandler(action, null);
        } catch {
          // ignore
        }
      });
    };
  }, [getPrevIndex, getNextIndex, skipRelative, togglePlayPause]);

  function scrollListToTop() {
    const list = musicListRef.current;
    if (!list) return;
    if (typeof list.scrollTo === 'function') {
      list.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      list.scrollTop = 0;
    }
  }

  function scrollListToBottom() {
    const list = musicListRef.current;
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
      if (!playlistItems.length) return;

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
        return;
      }

      if (lower === 'b') {
        event.preventDefault();
        // Restart the currently playing song from the start
        const audio = audioRef.current;
        if (audio && currentlyPlaying) {
          audio.currentTime = 0;
          audio.play();
        }
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [playlistItems.length, togglePlayPause, getPrevIndex, getNextIndex, skipRelative]);

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
        <div className="top-bar-center">
          <div className="media-nav" role="tablist" aria-label="Media sections">
            <button
              type="button"
              className="secondary media-nav-active"
              onClick={() => onNavigate('/media')}
            >
              Music
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => onNavigate('/media/video')}
            >
              Video
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => onNavigate('/media/photo')}
            >
              Photo
            </button>
          </div>
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
              <button
                id="group-folder-toggle"
                type="button"
                className={
                  'secondary sort-toggle' + (groupByFolder ? ' toggle-active' : '')
                }
                aria-pressed={groupByFolder ? 'true' : 'false'}
                aria-label="Toggle grouping by folder"
                onClick={() => setGroupByFolder((v) => !v)}
              >
                <Folder size={16} />
              </button>
            </div>
          </div>

          <div className="music-list-shell">
            <ul id="music-list" className="music-list" ref={musicListRef}>
              {groupByFolder
                ? groupKeys.map((groupKey) => (
                    <React.Fragment key={groupKey}>
                      <li className="folder-header">
                        <span className="folder-name">{groupKey}</span>
                        <button
                          type="button"
                          className="secondary folder-hide-button"
                          aria-label={
                            hiddenFolderSet.has(groupKey)
                              ? 'Show songs in this folder'
                              : 'Hide songs in this folder'
                          }
                          onClick={() => {
                            setHiddenFolders((prev) => {
                              const next = Array.isArray(prev) ? prev.slice() : [];
                              const idx = next.indexOf(groupKey);
                              if (idx >= 0) {
                                next.splice(idx, 1);
                              } else {
                                next.push(groupKey);
                              }
                              return next;
                            });
                          }}
                        >
                          {hiddenFolderSet.has(groupKey) ? (
                            <ChevronUp size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )}
                        </button>
                      </li>
                      {!hiddenFolderSet.has(groupKey) &&
                        groups[groupKey].map((item) => {
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
                  ))
                : filteredItems.map((item) => {
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
              <div 
                className="scrollbar-track" 
                ref={scrollTrackRef}
                onClick={handleTrackClick}
              >
                <div 
                  className={`scrollbar-thumb ${isDraggingThumb ? 'dragging' : ''}`}
                  onMouseDown={handleThumbMouseDown}
                />
              </div>
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
                        // If the error is a 404, replace with defaultArt
                        // This works for both CORS and non-CORS images
                        img.src = defaultArt;
                      }}
                      onLoad={(event) => {
                        // Remove fallback flag if image loads successfully
                        const img = event.currentTarget;
                        if (img.dataset.fallbackApplied === 'true' && img.src !== defaultArt) {
                          delete img.dataset.fallbackApplied;
                        }
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
