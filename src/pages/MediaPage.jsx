import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Play, ChevronUp, ChevronDown, ChevronLeft, Folder, Delete, X, ArrowUp, ArrowDown, RefreshCw, Search } from 'lucide-react';

import defaultArt from '/default-art.png';
import { clearMediaCache, fetchMediaItemsCached, getCachedMediaItems, getMediaEndpoint } from '../functions/mediaApiCache.js';
import Header from '../components/Header.jsx';
import { SkeletonMediaItem } from '../components/Skeleton.jsx';
import MusicPlayer from '../components/MusicPlayer.jsx';
import PhotoViewPage from './PhotoViewPage.jsx';
import { useMediaPlayer } from '../functions/mediaService.js';
import MediaItem from '../components/MediaItem.jsx';
import { dequeueNext, useQueue, applyQueueGrouping, getQueuePosition, showToast } from '../functions/queueService.js';
import SortDropdown from '../components/SortDropdown.jsx';
import {
  getItemId,
  getMediaType,
  pickTitle,
  pickArtist,
  pickFolderName,
  pickDuration,
  pickDurationSeconds,
  pickThumbnailUrl,
  pickSourceUrl,
  filterItems,
  sortItems,
  sortFolderKeys,
  isMojibake,
  decodeMojibakeString,
  extractTitleFromPath,
  formatTime,
} from '../functions/mediaUtils.js';
import MarqueeText from '../components/MarqueeText.jsx';


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
      if (!parsed.sortKey || parsed.sortKey === 'original') {
        parsed.sortKey = 'date';
      }
      return parsed;
    }
  } catch {
    // ignore
  }
  return {
    sortKey: 'date',
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



function getItemDomKey(item) {
  if (!item) return '';
  const id = getItemId(item);
  if (id != null) return String(id);
  if (typeof item.__index === 'number') return 'i-' + item.__index;
  return '';
}

function LazyImage({ src, alt, onError, className }) {
  const [isVisible, setIsVisible] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { rootMargin: '400px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={imgRef} className="skeleton-art" style={{ width: '100%', height: '100%', borderRadius: 'inherit', overflow: 'hidden' }}>
      {isVisible && (
        <img
          src={src}
          alt={alt}
          className={className}
          loading="lazy"
          decoding="async"
          onError={onError}
          style={{ opacity: 0, transition: 'opacity 0.3s ease', borderRadius: 'inherit' }}
          onLoad={(e) => { e.currentTarget.style.opacity = 1; }}
        />
      )}
    </div>
  );
}





function pickStreamUrl(serverUrl, item) {
  const id = getItemId(item);
  if (!id && id !== 0) return '';
  const base = serverUrl.replace(/\/$/, '');
  let url = base + '/media/audio/' + encodeURIComponent(id);
  return url;
}





function reorderByFolder(items, sortKey, isSortReversed) {
  if (!items || !items.length) return [];

  const groups = {};
  items.forEach((item) => {
    const folder = pickFolderName(item) || 'Other';
    if (!groups[folder]) groups[folder] = [];
    groups[folder].push(item);
  });

  const folderNames = sortFolderKeys(Object.keys(groups), items, sortKey, isSortReversed);

  const ordered = [];
  folderNames.forEach((folder) => {
    ordered.push(...groups[folder]);
  });

  return ordered;
}

const isElectron = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);

export default function MediaPage({
  serverUrl,
  onChangeServer,
  onNavigate,
  isActivePage = true,
  activePlaybackType = null,
  onStartPlayback,
  onPlaybackChange,
  playbackSnapshot,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [allItems, setAllItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [sortKey, setSortKey] = useState(() => {
    const s = loadSettings().sortKey;
    return (s && s !== 'original') ? s : 'date';
  });
  const [isSortReversed, setIsSortReversed] = useState(() => loadSettings().isSortReversed ?? false);
  const [groupByFolder, setGroupByFolder] = useState(() => loadSettings().groupByFolder ?? true);
  const [hiddenFolders, setHiddenFolders] = useState(() => loadSettings().hiddenFolders ?? []);
  // Index of the item in the original, unsorted list (items have a stable
  // `__index` we keep here so re-sorting doesn't change the playing track).
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isShuffle, setIsShuffle] = useState(() => loadSettings().isShuffle ?? false);
  const [isRepeat, setIsRepeat] = useState(() => loadSettings().isRepeat ?? false);
  const [isPlayerFullscreen, setIsPlayerFullscreen] = useState(() => loadSettings().isPlayerFullscreen ?? false);
  const audioRef = useRef(null);
  const {
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    currentDuration,
    setCurrentDuration,
    bufferedTime,
    setBufferedTime,
    updateBufferedTime,
    togglePlayPause,
    skipRelative,
    seekTo,
  } = useMediaPlayer(audioRef);
  const searchInputRef = useRef(null);
  const musicListRef = useRef(null);
  const scrollTrackRef = useRef(null);
  const scrollThumbRef = useRef(null);
  const [isDraggingThumb, setIsDraggingThumb] = useState(false);
  const dragStartYRef = useRef(0);
  const dragStartScrollTopRef = useRef(0);
  const isDraggingRef = useRef(false);
  const searchHistoryAddedRef = useRef(false);
  const fullscreenHistoryAddedRef = useRef(false);
  const miniPlayerAutoOpenedRef = useRef(false);
  const { queue, removeFromQueue, isItemQueued } = useQueue();
  const fullscreenTransitionTimerRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const containerRef = useRef(null);

  const [scrollOffset, setScrollOffset] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [isLargeLayout, setIsLargeLayout] = useState(false);

  useEffect(() => {
    const checkLayout = () => {
      const isMiniPhone = typeof window !== 'undefined' && (window.innerWidth <= 380 || window.innerHeight < 700);
      const isLarge = typeof window !== 'undefined' && !isMiniPhone && window.innerWidth > 700 && (window.innerWidth / window.innerHeight) >= 1.2;
      setIsLargeLayout(isLarge);
    };
    checkLayout();
    window.addEventListener('resize', checkLayout);
    return () => window.removeEventListener('resize', checkLayout);
  }, []);

  const setPlayerFullscreen = useCallback((nextValue) => {
    setIsPlayerFullscreen((prev) => {
      const resolved = typeof nextValue === 'function' ? nextValue(prev) : !!nextValue;
      return resolved;
    });
  }, []);

  useEffect(() => {
    if (!isActivePage) {
      setPlayerFullscreen(false);
    }
  }, [isActivePage, setPlayerFullscreen]);

  const handleReload = useCallback(() => {
    if (!serverUrl) return;
    clearMediaCache(serverUrl);
    setReloadNonce((value) => value + 1);
    setCurrentIndex(-1);
    setIsPlaying(false);
    setCurrentTime(0);
    setCurrentDuration(0);
    setBufferedTime(0);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current.load();
      audioRef.current.playbackRate = 1;
    }
    setScrollOffset(0);
    lastScrollTopRef.current = 0;
  }, [serverUrl, setIsPlaying, setCurrentTime, setCurrentDuration, setBufferedTime]);

  const stopAudioPlayback = useCallback(() => {
    setCurrentIndex(-1);
    setIsPlaying(false);
    setCurrentTime(0);
    setCurrentDuration(0);
    setBufferedTime(0);
    setPlayerFullscreen(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current.load();
      audioRef.current.playbackRate = 1;
    }
  }, [setIsPlaying, setCurrentTime, setCurrentDuration, setBufferedTime, setPlayerFullscreen]);

  useEffect(() => {
    if (activePlaybackType === 'video') {
      stopAudioPlayback();
    }
  }, [activePlaybackType, stopAudioPlayback]);

  useEffect(() => {
    return () => {
      if (fullscreenTransitionTimerRef.current) {
        window.clearTimeout(fullscreenTransitionTimerRef.current);
      }
    };
  }, []);

  // Track the visual viewport height so the layout adjusts when the
  // on-screen keyboard opens or closes on mobile devices.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let rafId = 0;
    const update = () => {
      rafId = 0;
      const el = containerRef.current;
      if (!el) return;
      el.style.setProperty('--app-height', `${vv.height}px`);
    };

    const onResize = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(update);
    };

    // Set initial value
    update();

    vv.addEventListener('resize', onResize);
    return () => {
      vv.removeEventListener('resize', onResize);
      if (rafId) cancelAnimationFrame(rafId);
      const el = containerRef.current;
      if (el) el.style.removeProperty('--app-height');
    };
  }, []);

  useEffect(() => {
    setScrollOffset(0);
    lastScrollTopRef.current = 0;
    if (musicListRef.current) {
      musicListRef.current.scrollTop = 0;
    }
  }, [searchQuery, sortKey, groupByFolder]);

  const updateScrollbar = useCallback(() => {
    const list = musicListRef.current;
    const track = scrollTrackRef.current;
    const thumb = scrollThumbRef.current;
    if (!list || !track || !thumb) return;

    const scrollHeight = list.scrollHeight;
    const clientHeight = list.clientHeight;
    const scrollTop = list.scrollTop;
    const trackHeight = track.clientHeight;

    if (scrollHeight <= clientHeight + 1 || trackHeight <= 0) {
      track.style.opacity = '0';
      track.style.pointerEvents = 'none';
      return;
    }

    track.style.opacity = '1';
    track.style.pointerEvents = 'auto';

    const minThumbHeight = 24;
    const thumbHeight = Math.max((clientHeight / scrollHeight) * trackHeight, minThumbHeight);
    const maxScrollTop = scrollHeight - clientHeight;
    const maxThumbTop = trackHeight - thumbHeight;
    const thumbTop = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0;

    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translate3d(0, ${thumbTop}px, 0)`;
  }, []);

  const handleScroll = useCallback(() => {
    updateScrollbar();
    const list = musicListRef.current;
    if (!list) return;

    const scrollTop = list.scrollTop;
    if (Math.abs(scrollTop - lastScrollTopRef.current) > 120) {
      lastScrollTopRef.current = scrollTop;
      setScrollOffset(scrollTop);
    }
  }, [updateScrollbar]);

  useEffect(() => {
    const list = musicListRef.current;
    if (list) {
      list.addEventListener('scroll', handleScroll, { passive: true });
      window.addEventListener('resize', updateScrollbar);
      const observer = new MutationObserver(updateScrollbar);
      observer.observe(list, { childList: true, subtree: true });
      updateScrollbar();
      return () => {
        list.removeEventListener('scroll', handleScroll);
        window.removeEventListener('resize', updateScrollbar);
        observer.disconnect();
      };
    }
  }, [handleScroll, updateScrollbar, allItems]);

  const handleThumbPointerDown = (e) => {
    const list = musicListRef.current;
    if (!list) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
    isDraggingRef.current = true;
    setIsDraggingThumb(true);
    dragStartYRef.current = e.clientY;
    dragStartScrollTopRef.current = list.scrollTop;
  };

  const handleThumbPointerMove = (e) => {
    if (!isDraggingRef.current) return;
    const list = musicListRef.current;
    const track = scrollTrackRef.current;
    const thumb = scrollThumbRef.current;
    if (!list || !track || !thumb) return;

    const deltaY = e.clientY - dragStartYRef.current;
    const trackHeight = track.clientHeight;
    const thumbHeight = thumb.clientHeight || 24;
    const scrollHeight = list.scrollHeight;
    const clientHeight = list.clientHeight;

    const maxScrollTop = scrollHeight - clientHeight;
    const maxThumbTop = trackHeight - thumbHeight;
    if (maxThumbTop <= 0) return;

    const scrollRatio = maxScrollTop / maxThumbTop;
    list.scrollTop = dragStartScrollTopRef.current + deltaY * scrollRatio;
  };

  const handleThumbPointerUp = (e) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setIsDraggingThumb(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }
  };

  const handleTrackClick = (e) => {
    if (e.target === scrollTrackRef.current) {
      const list = musicListRef.current;
      const track = scrollTrackRef.current;
      const thumb = scrollThumbRef.current;
      if (!list || !track || !thumb) return;

      const rect = track.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const trackHeight = track.clientHeight;
      const thumbHeight = thumb.clientHeight || 24;
      const maxScrollTop = list.scrollHeight - list.clientHeight;
      const maxThumbTop = trackHeight - thumbHeight;
      if (maxThumbTop <= 0) return;

      const targetThumbTop = clickY - thumbHeight / 2;
      const scrollPercent = Math.max(0, Math.min(1, targetThumbTop / maxThumbTop));
      list.scrollTo({ top: maxScrollTop * scrollPercent, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (!serverUrl) return;

    const cachedItems = getCachedMediaItems(serverUrl);
    if (cachedItems) {
      const items = cachedItems
        .map((item, index) => ({ ...item, __index: index }))
        .filter((item) => {
          const t =
            (item && (item.type || item.mediaType || item.kind || '')) || '';
          return String(t).toUpperCase() === 'AUDIO';
        });

      setAllItems(items);
      setLoading(false);
      setError('');
      return;
    }

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
            return String(t).toUpperCase() === 'AUDIO';
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
  }, [serverUrl, reloadNonce]);

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
  }, [isRepeat, currentIndex]);

  // Persist settings whenever they change.
  useEffect(() => { saveSettings({ sortKey }); }, [sortKey]);
  useEffect(() => { saveSettings({ isSortReversed }); }, [isSortReversed]);
  useEffect(() => { saveSettings({ groupByFolder }); }, [groupByFolder]);
  useEffect(() => { saveSettings({ isShuffle }); }, [isShuffle]);
  useEffect(() => { saveSettings({ isRepeat }); }, [isRepeat]);
  useEffect(() => { saveSettings({ hiddenFolders }); }, [hiddenFolders]);
  useEffect(() => { saveSettings({ isPlayerFullscreen }); }, [isPlayerFullscreen]);


  // Manage history state for search mode on mobile
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isElectron) return;

    const hasQuery = !!String(searchQuery || '').trim();
    if (hasQuery && !searchHistoryAddedRef.current) {
      const nextState = { ...(window.history.state || {}), __search: true };
      window.history.pushState(nextState, '', window.location.pathname);
      searchHistoryAddedRef.current = true;
    }

    if (!hasQuery && searchHistoryAddedRef.current) {
      searchHistoryAddedRef.current = false;
    }
  }, [searchQuery]);

  useEffect(() => {
    if (isElectron) return;

    function handlePopState(e) {
      const hasQuery = !!String(searchQuery || '').trim();
      if (!hasQuery) return;

      const state = e ? e.state : window.history.state;
      if (state && state.__search) {
        return;
      }

      setSearchQuery('');
      if (searchInputRef.current) {
        searchInputRef.current.blur();
      }
    }

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [searchQuery]);

  // When the music player is fullscreen, add a history entry so the back button
  // exits fullscreen instead of navigating away.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isElectron) return;

    if (isPlayerFullscreen && !fullscreenHistoryAddedRef.current) {
      const nextState = { ...(window.history.state || {}), __musicFullscreen: true };
      window.history.pushState(nextState, '', window.location.pathname);
      fullscreenHistoryAddedRef.current = true;
    }

    if (!isPlayerFullscreen && fullscreenHistoryAddedRef.current) {
      fullscreenHistoryAddedRef.current = false;
      if (window.history.state?.__musicFullscreen) {
        window.history.back();
      }
    }
  }, [isPlayerFullscreen]);

  useEffect(() => {
    if (isElectron) return;

    function handleFullscreenPopState(e) {
      if (!isPlayerFullscreen) return;

      const state = e.state || window.history.state;
      if (!state || !state.__musicFullscreen) {
        setPlayerFullscreen(false);
      }
    }

    window.addEventListener('popstate', handleFullscreenPopState);
    return () => {
      window.removeEventListener('popstate', handleFullscreenPopState);
    };
  }, [isPlayerFullscreen, setPlayerFullscreen]);

  // Full playlist: all items, sorted but not filtered by search.
  const sortedAllItems = useMemo(
    () => sortItems(allItems, sortKey, isSortReversed),
    [allItems, sortKey, isSortReversed]
  );

  const hiddenFolderSet = useMemo(
    () => new Set(hiddenFolders || []),
    [hiddenFolders]
  );

  // Optionally reorder the sorted list by folder name so that
  // playback order matches the grouped visual order.
  // When groupByFolder is enabled, also exclude songs from hidden
  // (collapsed) folders so they don't appear in the playback queue.
  const playlistItems = useMemo(
    () => {
      if (!groupByFolder) return sortedAllItems;
      const reordered = reorderByFolder(sortedAllItems, sortKey, isSortReversed);
      if (hiddenFolderSet.size === 0) return reordered;
      return reordered.filter(
        (item) => !hiddenFolderSet.has(pickFolderName(item) || 'Other')
      );
    },
    [sortedAllItems, groupByFolder, hiddenFolderSet, sortKey, isSortReversed]
  );


  useEffect(() => {
    if (allItems.length === 0) {
      setCurrentIndex(-1);
      setIsPlaying(false);
      setCurrentTime(0);
      setCurrentDuration(0);
    }
  }, [allItems.length]);

  // Direct play function for any item (from playlist, queue, or hidden folder).
  function handlePlayItem(item, playReason) {
    if (!audioRef.current || !item) return;
    onStartPlayback?.('music');
    if (isItemQueued(item)) {
      removeFromQueue(item, true);
    }
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
        setIsPlaying(false);
      });
    const originalIndex =
      typeof item.__index === 'number' ? item.__index : -1;
    setCurrentIndex(originalIndex);
    setCurrentTime(0);
    setBufferedTime(0);

    const isMiniPhone = window.innerWidth <= 380 || window.innerHeight < 700;
    if (isActivePage && isMiniPhone && !currentlyPlaying && !miniPlayerAutoOpenedRef.current) {
      miniPlayerAutoOpenedRef.current = true;
      setPlayerFullscreen(true);
    }
  }

  // Play by index within the active playlist (or fallback to sortedAllItems).
  function handlePlay(index, playReason) {
    const list = playlistItems.length ? playlistItems : sortedAllItems;
    if (!audioRef.current || index < 0 || index >= list.length) return;
    handlePlayItem(list[index], playReason);
  }

  // Play a specific item directly (from queue, list click, etc.).
  function handlePlayForItem(item, playReason) {
    if (!item) return;
    handlePlayItem(item, playReason);
  }

  function getCurrentPlaylistIndex() {
    if (currentIndex < 0) return -1;
    const list = playlistItems.length ? playlistItems : sortedAllItems;
    return list.findIndex((item) =>
      typeof item.__index === 'number'
        ? item.__index === currentIndex
        : false
    );
  }

  function getNextIndex() {
    const list = playlistItems.length ? playlistItems : sortedAllItems;
    const n = list.length;
    if (!n) return -1;
    const playlistIndex = getCurrentPlaylistIndex();
    if (isShuffle && n > 1) {
      let next = playlistIndex >= 0 ? playlistIndex : 0;
      for (let i = 0; i < 5 && next === playlistIndex; i += 1) {
        next = Math.floor(Math.random() * n);
      }
      return next;
    }
    if (playlistIndex < 0) {
      const currentAllIdx = sortedAllItems.findIndex((it) => it.__index === currentIndex);
      if (currentAllIdx >= 0) {
        const nextItemInAll = sortedAllItems.slice(currentAllIdx + 1).find((it) =>
          list.some((p) => p.__index === it.__index)
        );
        if (nextItemInAll) {
          const nextIdx = list.findIndex((p) => p.__index === nextItemInAll.__index);
          if (nextIdx >= 0) return nextIdx;
        }
      }
      return 0;
    }
    return (playlistIndex + 1) % n;
  }

  function getPrevIndex() {
    const list = playlistItems.length ? playlistItems : sortedAllItems;
    const n = list.length;
    if (!n) return -1;
    const playlistIndex = getCurrentPlaylistIndex();
    if (isShuffle && n > 1) {
      let prev = playlistIndex >= 0 ? playlistIndex : 0;
      for (let i = 0; i < 5 && prev === playlistIndex; i += 1) {
        prev = Math.floor(Math.random() * n);
      }
      return prev;
    }
    if (playlistIndex < 0) {
      const currentAllIdx = sortedAllItems.findIndex((it) => it.__index === currentIndex);
      if (currentAllIdx >= 0) {
        const prevItemInAll = [...sortedAllItems.slice(0, currentAllIdx)].reverse().find((it) =>
          list.some((p) => p.__index === it.__index)
        );
        if (prevItemInAll) {
          const prevIdx = list.findIndex((p) => p.__index === prevItemInAll.__index);
          if (prevIdx >= 0) return prevIdx;
        }
      }
      return n - 1;
    }
    return (playlistIndex - 1 + n) % n;
  }

  function handleEnded() {
    if (isRepeat) {
      // audio.loop handles repeating current track
      return;
    }
    const queued = dequeueNext();
    if (queued) {
      handlePlayForItem(queued, 'next');
      return;
    }
    const idx = getNextIndex();
    if (idx >= 0) {
      handlePlay(idx, 'next');
    }
  }

  const hasItems = allItems.length > 0;

  // Group only the currently visible (filtered) items for display by folder
  // when the toggle is enabled. We use the full sorted list (before hidden-
  // folder filtering) so that headers for hidden folders still appear, letting
  // users toggle them back on.
  const rawDisplayItems = useMemo(
    () => filterItems(sortedAllItems, searchQuery),
    [sortedAllItems, searchQuery]
  );

  const displayItems = useMemo(
    () => applyQueueGrouping(rawDisplayItems, queue, isSortReversed),
    [rawDisplayItems, queue, isSortReversed]
  );

  const groups = useMemo(() => {
    if (!groupByFolder) return {};
    const map = {};
    rawDisplayItems.forEach((item) => {
      const folder = isItemQueued(item) ? 'Queued' : (pickFolderName(item) || 'Other');
      if (!map[folder]) map[folder] = [];
      map[folder].push(item);
    });

    if (map['Queued']) {
      map['Queued'].sort((a, b) => getQueuePosition(a) - getQueuePosition(b));
    }

    return map;
  }, [rawDisplayItems, groupByFolder, queue, isItemQueued]);

  const groupKeys = useMemo(() => {
    if (!groupByFolder) return [];
    const keys = Object.keys(groups).filter((k) => k !== 'Queued');
    const sortedKeys = sortFolderKeys(keys, rawDisplayItems, sortKey, isSortReversed);

    if (groups['Queued']) {
      if (isSortReversed) {
        // Arrow UP: Queued folder at the VERY TOP!
        return ['Queued', ...sortedKeys];
      } else {
        // Arrow DOWN: Queued folder at the VERY BOTTOM!
        return [...sortedKeys, 'Queued'];
      }
    }

    return sortedKeys;
  }, [groups, groupByFolder, rawDisplayItems, sortKey, isSortReversed]);

  const allFolderKeys = useMemo(
    () => groupKeys.filter((groupKey) => groupKey !== 'Queued'),
    [groupKeys]
  );
  const areAllFoldersHidden =
    allFolderKeys.length > 0 && allFolderKeys.every((groupKey) => hiddenFolderSet.has(groupKey));

  const toggleAllFolders = useCallback(() => {
    setHiddenFolders((prev) => {
      const current = Array.isArray(prev) ? prev : [];
      if (areAllFoldersHidden) {
        return current.filter((folder) => !allFolderKeys.includes(folder));
      }
      return Array.from(new Set([...current, ...allFolderKeys]));
    });
  }, [allFolderKeys, areAllFoldersHidden]);

  const flatGroupedItems = useMemo(() => {
    if (!groupByFolder) {
      return displayItems.map(item => ({
        type: 'item',
        key: getItemDomKey(item) || (getItemId(item) ?? item.__index),
        data: item
      }));
    }

    const flat = [];
    flat.push({
      type: 'header',
      key: 'header-All',
      groupKey: 'All',
      isHidden: areAllFoldersHidden,
      isAllFoldersHeader: true,
    });
    groupKeys.forEach((groupKey) => {
      const groupItems = groups[groupKey] || [];
      const isHidden = groupKey !== 'Queued' && hiddenFolderSet.has(groupKey);
      flat.push({
        type: 'header',
        key: `header-${groupKey}`,
        groupKey: groupKey,
        itemCount: groupItems.length,
        isHidden: isHidden
      });
      if (!isHidden) {
        groupItems.forEach((item) => {
          flat.push({
            type: 'item',
            key: getItemDomKey(item) || (getItemId(item) ?? item.__index),
            data: item
          });
        });
      }
    });
    return flat;
  }, [groupByFolder, displayItems, groupKeys, groups, hiddenFolderSet, allFolderKeys, areAllFoldersHidden]);

  const flatGroupedItemsRef = useRef(flatGroupedItems);
  flatGroupedItemsRef.current = flatGroupedItems;

  const currentlyPlaying = useMemo(() => {
    if (currentIndex < 0) return null;
    // First try to find the track in the active playlist.
    const found = playlistItems.find((item) =>
      typeof item.__index === 'number' ? item.__index === currentIndex : false
    );
    if (found) return found;
    // If the track's folder was hidden it won't be in playlistItems any more,
    // but the audio element is still playing it.  Fall back to the full list
    // so that the player bar keeps showing metadata for the current track.
    const fallback = allItems.find((item) =>
      typeof item.__index === 'number' ? item.__index === currentIndex : false
    );
    return fallback || null;
  }, [playlistItems, allItems, currentIndex]);

  const currentArtUrl = currentlyPlaying
    ? pickThumbnailUrl(serverUrl, currentlyPlaying)
    : defaultArt;

  useEffect(() => {
    onPlaybackChange?.(currentlyPlaying ? {
      type: 'music', item: currentlyPlaying, currentTime, duration: currentDuration, isPlaying,
    } : null);
  }, [currentlyPlaying, currentTime, currentDuration, isPlaying, onPlaybackChange]);

  const mediaSessionArtwork = useMemo(() => {
    const raw = String(currentArtUrl || '').trim();
    if (!raw) return [];

    let src = raw;
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw);

    if (!hasScheme && typeof window !== 'undefined') {
      try {
        src = new URL(raw, serverUrl || window.location.href).toString();
      } catch {
        return [];
      }
    }

    return [
      {
        src,
        sizes: '512x512',
        type: 'image/jpeg',
      },
    ];
  }, [currentArtUrl, serverUrl]);

  useEffect(() => {
    if (!currentlyPlaying) {
      setCurrentTime(0);
      setBufferedTime(0);
      setCurrentDuration(0);
      setIsPlaying(false);
      return;
    }
    const metaDuration = pickDurationSeconds(currentlyPlaying);
    setCurrentDuration(metaDuration || 0);
    setBufferedTime(0);
  }, [currentlyPlaying]);

  // Keep the browser/OS media controls (Media Session API) in sync
  // with the current track's metadata and playback state.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    if (activePlaybackType !== 'music') {
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
    const artist = pickArtist(currentlyPlaying) || 'LocalStream';
    const album = pickFolderName(currentlyPlaying) || '';

    try {
      // eslint-disable-next-line no-undef
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork: mediaSessionArtwork,
      });
    } catch {
      // Some environments reject artwork URLs. Retry with text-only metadata.
      try {
        // eslint-disable-next-line no-undef
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist,
          album,
        });
      } catch {
        // Some browsers may not support MediaMetadata fully; fail silently.
      }
    }
  }, [activePlaybackType, currentlyPlaying, mediaSessionArtwork]);

  function scrollToCurrent() {
    if (!currentlyPlaying) return;

    function doScroll() {
      const domKey = getItemDomKey(currentlyPlaying);
      if (!domKey) return;
      const list = musicListRef.current;
      if (!list) return;

      const targetId = getItemId(currentlyPlaying);
      const itemIndex = flatGroupedItemsRef.current.findIndex(
        (itemObj) =>
          itemObj.type === 'item' &&
          (itemObj.data === currentlyPlaying ||
            (getItemId(itemObj.data) != null && getItemId(itemObj.data) === targetId))
      );

      if (itemIndex >= 0) {
        const itemHeight = typeof window !== 'undefined' && (window.innerWidth <= 380 || window.innerHeight < 700) ? 46 : 60;
        const itemTop = itemIndex * itemHeight;
        const viewportHeight = list.clientHeight;
        const targetScrollTop = Math.max(0, itemTop - (viewportHeight / 2) + (itemHeight / 2));

        lastScrollTopRef.current = targetScrollTop;
        setScrollOffset(targetScrollTop);

        list.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
      } else {
        const el = list.querySelector('[data-track-key="' + domKey + '"]');
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }

    let needsRenderUpdate = false;
    let needsFullscreenExit = false;

    if (isPlayerFullscreen) {
      setPlayerFullscreen(false);
      needsFullscreenExit = true;
      needsRenderUpdate = true;
    }

    if (searchQuery) {
      setSearchQuery('');
      needsRenderUpdate = true;
    }

    if (groupByFolder) {
      const folderName = pickFolderName(currentlyPlaying) || 'Other';
      if (hiddenFolderSet.has(folderName)) {
        setHiddenFolders((prev) =>
          (Array.isArray(prev) ? prev : []).filter((name) => name !== folderName)
        );
        needsRenderUpdate = true;
      }
    }

    if (needsRenderUpdate) {
      window.setTimeout(doScroll, needsFullscreenExit ? 200 : 100);
    } else {
      doScroll();
    }
  }



  const lastPositionSecondRef = useRef(-1);

  function handleTogglePlayPause() {
    if (!currentlyPlaying) {
      if (playlistItems.length === 0) return;
      handlePlay(0, 'start');
      return;
    }
    togglePlayPause();
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) return;
    const t = audio.currentTime || 0;
    setCurrentTime(t);
    updateBufferedTime();

    if (activePlaybackType === 'music' && typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      const currentSecond = Math.floor(t);
      if (currentSecond !== lastPositionSecondRef.current) {
        lastPositionSecondRef.current = currentSecond;
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
  }

  function handleLoadedMetadata() {
    const audio = audioRef.current;
    if (!audio) return;
    if (Number.isFinite(audio.duration)) {
      setCurrentDuration(Math.floor(audio.duration));
    }
    updateBufferedTime();
  }

  function handleProgress() {
    updateBufferedTime();
  }

  function handleAudioPlay() {
    onStartPlayback?.('music');
    setIsPlaying(true);
  }

  function handleAudioPause() {
    setIsPlaying(false);
  }

  function handleSeek(event) {
    const value = Number(event.target.value) || 0;
    seekTo(value);
    updateBufferedTime();
  }

  // Reflect play/pause state in the Media Session API.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    if (activePlaybackType !== 'music') {
      return;
    }
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch {
      // ignore
    }
  }, [activePlaybackType, isPlaying]);

  const mediaHandlersRef = useRef({});
  mediaHandlersRef.current = {
    getPrevIndex,
    getNextIndex,
    handlePlay,
    handlePlayForItem,
    skipRelative,
    togglePlayPause,
  };

  // Wire hardware/media key controls (play/pause, next, previous, seek).
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    if (activePlaybackType !== 'music') {
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
        mediaHandlersRef.current.togglePlayPause();
      }
    });

    safeSet('pause', () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (!audio.paused) {
        mediaHandlersRef.current.togglePlayPause();
      }
    });

    safeSet('previoustrack', () => {
      const idx = mediaHandlersRef.current.getPrevIndex();
      if (idx >= 0) mediaHandlersRef.current.handlePlay(idx, 'prev');
    });

    safeSet('nexttrack', () => {
      const queued = dequeueNext();
      if (queued) {
        mediaHandlersRef.current.handlePlayForItem(queued, 'next');
        return;
      }
      const idx = mediaHandlersRef.current.getNextIndex();
      if (idx >= 0) mediaHandlersRef.current.handlePlay(idx, 'next');
    });

    safeSet('seekbackward', (details) => {
      const delta = (details && details.seekOffset) || 10;
      mediaHandlersRef.current.skipRelative(-delta);
    });

    safeSet('seekforward', (details) => {
      const delta = (details && details.seekOffset) || 10;
      mediaHandlersRef.current.skipRelative(delta);
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
  }, [activePlaybackType]);

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
    if (!isActivePage) return;

    function handleKeyDown(event) {
      if (!currentlyPlaying && !playlistItems.length) return;

      const active = document.activeElement;
      if (searchInputRef.current && active === searchInputRef.current) {
        return;
      }
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        return;
      }

      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const key = event.key;
      const lower = typeof key === 'string' ? key.toLowerCase() : '';

      if (key === 'Escape' || key === 'Esc') {
        if (isPlayerFullscreen) {
          event.preventDefault();
          setPlayerFullscreen(false);
          return;
        }
      }

      if (key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        togglePlayPause();
        return;
      }

      if (lower === 'f') {
        event.preventDefault();
        if (currentlyPlaying) {
          setPlayerFullscreen((prev) => !prev);
        }
        return;
      }

      if (lower === 'c') {
        event.preventDefault();
        const idx = getPrevIndex();
        if (idx >= 0) handlePlay(idx, 'prev');
        return;
      }

      if (lower === 'm') {
        event.preventDefault();
        const idx = getNextIndex();
        if (idx >= 0) handlePlay(idx, 'next');
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
  }, [isActivePage, playlistItems.length, togglePlayPause, getPrevIndex, getNextIndex, skipRelative, currentlyPlaying, isPlayerFullscreen, setPlayerFullscreen]);

  return (
    <div className="media-page-container" ref={containerRef}>
      <Header
        title="My Music"
        serverUrl={serverUrl}
        activeSection="music"
        onNavigate={onNavigate}
        onChangeServer={onChangeServer}
        reloadNonce={reloadNonce}
        isActivePage={isActivePage}
        playbackSnapshot={playbackSnapshot}
      />

      <main className={
        'page music-page' +
        (currentlyPlaying ? ' has-playing' : '') +
        (currentlyPlaying && isPlayerFullscreen ? ' music-player-active' : '')
      }>
        <section className={
          'card full music-player-card' +
          (currentlyPlaying ? ' has-playing' : '')
        }>
          {loading && (
            <div id="loading" className="info">
              Loading music from LocalStream…
            </div>
          )}
          {error && !loading && (
            <div id="error" className="error">
              <span>{error}</span>
              <button
                type="button"
                className="alert-dismiss"
                onClick={() => setError('')}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {!loading && !error && !hasItems && (
            <div id="empty" className="info">
              No music found on this server.
            </div>
          )}

          <div className={`toolbar-row${isSearchExpanded || searchQuery ? ' search-active' : ''}`}>
            <div className="search-row">
              <button
                type="button"
                className="icon-button sort-icon-button search-back-button"
                aria-label="Close search"
                title="Close search"
                onClick={() => {
                  setIsSearchExpanded(false);
                  setSearchQuery('');
                }}
              >
                <ChevronLeft size={16} />
              </button>
              <div className="search-input-wrapper">
                <Search size={16} className="search-input-icon" />
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
              <button
                type="button"
                className="search-clear-button"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                disabled={!searchQuery}
              >
                <Delete size={16} />
              </button>
            </div>
            <div className="sort-row">
              <label htmlFor="sort-select" className="sort-label">
                Sort by
              </label>
              <SortDropdown
                id="sort-select"
                ariaLabel="Sort music list"
                value={sortKey}
                options={[
                  { value: 'date', label: 'Date' },
                  { value: 'name', label: 'Name' },
                  { value: 'duration', label: 'Duration' },
                ]}
                onChange={(e) => {
                  const val = e.target.value || '';
                  setSortKey(val);
                  const labels = { date: 'Date', name: 'Name', duration: 'Duration' };
                  const label = labels[val] || (val ? val.charAt(0).toUpperCase() + val.slice(1) : 'Default');
                  showToast({ action: 'sort', message: `Sort by: ${label}` });
                }}
              />
              <button
                id="sort-reverse"
                type="button"
                className="icon-button sort-icon-button"
                aria-label={isSortReversed ? 'Descending order' : 'Ascending order'}
                title={isSortReversed ? 'Descending order' : 'Ascending order'}
                onClick={() => {
                  const next = !isSortReversed;
                  setIsSortReversed(next);
                  showToast({
                    action: 'sort_order',
                    isSortReversed: next,
                    message: `Sort order: ${next ? 'Descending' : 'Ascending'}`,
                  });
                }}
              >
                {isSortReversed ? (
                  <ArrowDown size={16} />
                ) : (
                  <ArrowUp size={16} />
                )}
              </button>
              <button
                id="group-folder-toggle"
                type="button"
                className={
                  'icon-button sort-icon-button sort-toggle' + (groupByFolder ? ' toggle-active' : '')
                }
                aria-pressed={groupByFolder ? 'true' : 'false'}
                aria-label="Toggle grouping by folder"
                onClick={() => {
                  const next = !groupByFolder;
                  setGroupByFolder(next);
                  showToast({
                    action: 'group_folder',
                    groupByFolder: next,
                    message: `Group by folder: ${next ? 'On' : 'Off'}`,
                  });
                }}
              >
                <Folder size={16} />
              </button>
              <button
                type="button"
                className="icon-button sort-icon-button"
                aria-label="Reload media"
                title="Reload media"
                onClick={handleReload}
              >
                <RefreshCw size={16} />
              </button>
              <button
                type="button"
                className="icon-button sort-icon-button search-toggle-button"
                aria-label="Open search"
                title="Open search"
                onClick={() => {
                  setIsSearchExpanded(true);
                  setTimeout(() => {
                    searchInputRef.current?.focus();
                  }, 50);
                }}
              >
                <Search size={16} />
              </button>
            </div>
          </div>

          <div className="music-list-shell">
            <ul id="music-list" className="music-list" ref={musicListRef}>
              {loading && allItems.length === 0 ? (
                Array.from({ length: 12 }).map((_, i) => (
                  <SkeletonMediaItem key={`loading-skel-${i}`} />
                ))
              ) : (
                <>
                  {(() => {
                    const itemHeight = typeof window !== 'undefined' && (window.innerWidth <= 380 || window.innerHeight < 700) ? 46 : 60;
                    const visibleCount = 15;
                    const buffer = 15;
                    const startIndex = Math.max(0, Math.floor(scrollOffset / itemHeight) - buffer);
                    const endIndex = Math.min(flatGroupedItems.length, startIndex + visibleCount + 2 * buffer);

                    const visibleItemsSlice = flatGroupedItems.slice(startIndex, endIndex);

                    const paddingTop = startIndex * itemHeight;
                    const paddingBottom = (flatGroupedItems.length - endIndex) * itemHeight;

                    return (
                      <>
                        {paddingTop > 0 && (
                          <li style={{ height: `${paddingTop}px`, pointerEvents: 'none' }} key="top-spacer" />
                        )}
                        {visibleItemsSlice.map((itemObj) => {
                          if (itemObj.type === 'header') {
                            const { groupKey, isHidden, isAllFoldersHeader } = itemObj;
                            return (
                              <li className="folder-header" key={itemObj.key}>
                                <span className="folder-name">
                                  {isAllFoldersHeader ? groupKey : `${groupKey} (${itemObj.itemCount ?? 0})`}
                                </span>
                                {groupKey !== 'Queued' && (
                                  <button
                                    type="button"
                                    className="secondary folder-hide-button"
                                    aria-label={
                                      isAllFoldersHeader
                                        ? (isHidden ? 'Show all folders' : 'Hide all folders')
                                        : (isHidden ? 'Show songs in this folder' : 'Hide songs in this folder')
                                    }
                                    onClick={isAllFoldersHeader ? toggleAllFolders : () => {
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
                                    {isHidden ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                  </button>
                                )}
                              </li>
                            );
                          } else {
                            const item = itemObj.data;
                            const isActive =
                              !!currentlyPlaying &&
                              (currentlyPlaying === item ||
                                (getItemId(currentlyPlaying) != null &&
                                  getItemId(currentlyPlaying) === getItemId(item)));
                            return (
                              <MediaItem
                                key={itemObj.key}
                                item={item}
                                isActive={isActive}
                                isPlayingActive={isActive && isPlaying}
                                serverUrl={serverUrl}
                                onPlay={handlePlayForItem}
                                groupByFolder={groupByFolder}
                              />
                            );
                          }
                        })}
                        {paddingBottom > 0 && (
                          <li style={{ height: `${paddingBottom}px`, pointerEvents: 'none' }} key="bottom-spacer" />
                        )}
                      </>
                    );
                  })()}
                </>
              )}
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
                  ref={scrollThumbRef}
                  onPointerDown={handleThumbPointerDown}
                  onPointerMove={handleThumbPointerMove}
                  onPointerUp={handleThumbPointerUp}
                  onPointerCancel={handleThumbPointerUp}
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

          <MusicPlayer
            isLargeLayout={isLargeLayout}
            currentlyPlaying={currentlyPlaying}
            currentArtUrl={currentArtUrl}
            isPlayerFullscreen={isPlayerFullscreen}
            setPlayerFullscreen={setPlayerFullscreen}
            scrollToCurrent={scrollToCurrent}
            currentTime={currentTime}
            currentDuration={currentDuration}
            bufferedTime={bufferedTime}
            handleSeek={handleSeek}
            isRepeat={isRepeat}
            setIsRepeat={setIsRepeat}
            getPrevIndex={getPrevIndex}
            handlePlay={handlePlay}
            skipRelative={skipRelative}
            isPlaying={isPlaying}
            togglePlayPause={handleTogglePlayPause}
            getNextIndex={getNextIndex}
            isShuffle={isShuffle}
            setIsShuffle={setIsShuffle}
            formatTime={formatTime}
            pickDurationSeconds={pickDurationSeconds}
            pickTitle={pickTitle}
            pickArtist={pickArtist}
            defaultArt={defaultArt}
            handleEnded={handleEnded}
            handleTimeUpdate={handleTimeUpdate}
            handleLoadedMetadata={handleLoadedMetadata}
            handleProgress={handleProgress}
            handleAudioPlay={handleAudioPlay}
            handleAudioPause={handleAudioPause}
            handlePlayForItem={handlePlayForItem}
            audioRef={audioRef}
            MarqueeTextComponent={MarqueeText}
          />
        </section>
      </main>
    </div>
  );
}
