import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { AudioLines, Play, Pause, Rewind, FastForward, SkipBack, SkipForward, Folder, ChevronUp, ChevronDown, Maximize, Minimize, PictureInPicture2, Repeat, AppWindow, Square } from 'lucide-react';
import { fetchMediaItemsCached, getMediaEndpoint } from './mediaApiCache.js';
import Header from './Header.jsx';
import {
  getItemId,
  pickTitle,
  pickDateValue,
  pickDuration,
  pickThumbnailUrl,
  pickSourceUrl,
  filterItems,
  sortItems,
  getMediaType,
  pickFolderName,
  pickDurationSeconds,
} from './mediaUtils.js';

const STORAGE_KEY = 'localstream_server_url';
const SETTINGS_KEY = 'localstream_video_settings';

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.hiddenFolders)) parsed.hiddenFolders = [];
      return parsed;
    }
  } catch {}
  return { hiddenFolders: [] };
}

function saveSettings(patch) {
  try {
    const existing = loadSettings();
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...existing, ...patch }));
  } catch {}
}

function getItemDomKey(item) {
  if (!item) return '';
  const id = getItemId(item);
  if (id != null) return String(id);
  if (typeof item.__index === 'number') return 'i-' + item.__index;
  return '';
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return hrs + ':' + (mins < 10 ? '0' + mins : mins) + ':' + (secs < 10 ? '0' + secs : secs);
  }
  return mins + ':' + (secs < 10 ? '0' + secs : secs);
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

function isTypingElement(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;

  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;

  const inputType = String(el.type || '').toLowerCase();
  if (inputType === 'hidden' || inputType === 'checkbox' || inputType === 'radio' || inputType === 'range' || inputType === 'button' || inputType === 'submit' || inputType === 'reset' || inputType === 'file') {
    return false;
  }

  return !el.readOnly && !el.disabled;
}

function detectMobileViewport() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const ua = String(navigator.userAgent || '');
  const uaDataMobile = !!navigator.userAgentData?.mobile;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
  const coarsePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const touchScreen = Number(navigator.maxTouchPoints || 0) > 0;

  return uaDataMobile || uaMobile || (coarsePointer && touchScreen);
}

function detectTouchInput() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const touchPoints = Number(navigator.maxTouchPoints || 0) > 0;
  const touchEvent = 'ontouchstart' in window;
  const coarsePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  return touchPoints || touchEvent || coarsePointer;
}

function getFullscreenElement() {
  if (typeof document === 'undefined') return null;

  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement ||
    null
  );
}

function exitAnyFullscreen() {
  if (typeof document === 'undefined') return Promise.resolve();

  if (typeof document.exitFullscreen === 'function') {
    return document.exitFullscreen();
  }
  if (typeof document.webkitExitFullscreen === 'function') {
    return document.webkitExitFullscreen();
  }
  if (typeof document.msExitFullscreen === 'function') {
    return document.msExitFullscreen();
  }

  return Promise.resolve();
}

function requestElementFullscreen(el) {
  if (!el) return Promise.resolve();

  if (typeof el.requestFullscreen === 'function') {
    return el.requestFullscreen();
  }
  if (typeof el.webkitRequestFullscreen === 'function') {
    return el.webkitRequestFullscreen();
  }
  if (typeof el.msRequestFullscreen === 'function') {
    return el.msRequestFullscreen();
  }

  return Promise.resolve();
}

export default function VideoPage({
  serverUrl,
  onChangeServer,
  onNavigate,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState(() => loadSettings().searchQuery ?? '');
  const [sortKey, setSortKey] = useState(() => loadSettings().sortKey ?? 'date');
  const [isSortReversed, setIsSortReversed] = useState(() => loadSettings().isSortReversed ?? false);
  const [groupByFolder, setGroupByFolder] = useState(() => loadSettings().groupByFolder ?? true);
  const [hiddenFolders, setHiddenFolders] = useState(() => loadSettings().hiddenFolders ?? []);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [shouldAutoPlaySelectedVideo, setShouldAutoPlaySelectedVideo] = useState(false);

  // Player state (mirrors music player)
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentDuration, setCurrentDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(false);
  const [isFloatingWindow, setIsFloatingWindow] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isPortraitVideo, setIsPortraitVideo] = useState(false);
  const [videoAspectRatio, setVideoAspectRatio] = useState(16 / 9);
  const [isLooping, setIsLooping] = useState(false);
  const [keyboardActionHint, setKeyboardActionHint] = useState(null);
  const [isMobileViewport, setIsMobileViewport] = useState(() => detectMobileViewport());
  const [isTouchInput, setIsTouchInput] = useState(() => detectTouchInput());

  const videoRef = useRef(null);
  const videoContainerRef = useRef(null);
  const searchInputRef = useRef(null);
  const hideTimerRef = useRef(null);
  const keyboardHintTimerRef = useRef(null);
  const musicListRef = useRef(null);
  const scrollTrackRef = useRef(null);
  const fullscreenTouchStartRef = useRef(null);
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
  }, [updateScrollbar, items, groupByFolder]);

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
        
        const targetThumbTop = clickY - thumbHeight / 2;
        const scrollPercent = Math.max(0, Math.min(1, targetThumbTop / (trackHeight - thumbHeight)));
        list.scrollTop = (list.scrollHeight - list.clientHeight) * scrollPercent;
    }
  };

  const pageTitle = 'My Videos';
  const emptyText = 'No videos found on this server.';

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
          .filter((item) => getMediaType(item) === 'VIDEO');

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
  }, [serverUrl]);

  useEffect(() => {
    if (!serverUrl) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, serverUrl);
    } catch {
      // ignore
    }
  }, [serverUrl]);

  // Persist settings whenever they change
  useEffect(() => { saveSettings({ sortKey }); }, [sortKey]);
  useEffect(() => { saveSettings({ isSortReversed }); }, [isSortReversed]);
  useEffect(() => { saveSettings({ groupByFolder }); }, [groupByFolder]);
  useEffect(() => { saveSettings({ hiddenFolders }); }, [hiddenFolders]);
  useEffect(() => { saveSettings({ searchQuery }); }, [searchQuery]);

  const hiddenFolderSet = useMemo(() => new Set(hiddenFolders || []), [hiddenFolders]);

  const filtered = useMemo(() => filterItems(items, searchQuery), [items, searchQuery]);
  const sortedItems = useMemo(
    () => sortItems(filtered, sortKey, isSortReversed),
    [filtered, sortKey, isSortReversed]
  );
  const groupedItems = useMemo(() => {
    if (!groupByFolder) return null;
    const map = {};
    sortedItems.forEach((item) => {
      const folder = pickFolderName(item) || 'Other';
      if (!map[folder]) map[folder] = [];
      map[folder].push(item);
    });
    return map;
  }, [sortedItems, groupByFolder]);
  const groupKeys = useMemo(
    () =>
      groupByFolder && groupedItems
        ? Object.keys(groupedItems).sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: 'base' })
          )
        : [],
    [groupedItems, groupByFolder]
  );

  const selectedVideo = useMemo(() => {
    if (!items.length || selectedVideoId == null) return null;
    const found = items.find((item) => getItemId(item) === selectedVideoId);
    return found || null;
  }, [items, selectedVideoId]);

  const selectedVideoSource = useMemo(
    () => (selectedVideo ? pickSourceUrl(serverUrl, selectedVideo) : ''),
    [serverUrl, selectedVideo]
  );

  const selectedVideoPoster = useMemo(
    () => (selectedVideo ? pickThumbnailUrl(serverUrl, selectedVideo) : ''),
    [serverUrl, selectedVideo]
  );

  const mediaSessionArtwork = useMemo(() => {
    const raw = String(selectedVideoPoster || '').trim();
    if (!raw || raw === '/default-art.png') {
      return [];
    }

    let src = raw;
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw);

    if (!hasScheme) {
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
      },
    ];
  }, [selectedVideoPoster, serverUrl]);

  useEffect(() => {
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
  }, [items, selectedVideoId]);

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

  // Reset player state when selected video changes
  useEffect(() => {
    if (!selectedVideo) {
      setIsPlaying(false);
      setCurrentTime(0);
      setCurrentDuration(0);
      setVideoAspectRatio(16 / 9);
      return;
    }
    setCurrentTime(0);
    setIsPlaying(false);
    const metaDuration = pickDurationSeconds(selectedVideo);
    setCurrentDuration(metaDuration || 0);
  }, [selectedVideo]);

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  const toggleLooping = useCallback(() => {
    setIsLooping((prev) => !prev);
  }, []);

  // Map action keys to Lucide icon components
  const actionIcons = {
    play: <Play size={32} fill="currentColor" stroke="none" />, 
    pause: <Pause size={32} fill="currentColor" stroke="none" />, 
    prev: <SkipBack size={32} />, 
    next: <SkipForward size={32} />, 
    rewind: <Rewind size={32} />, 
    forward: <FastForward size={32} />, 
    restart: <Square size={32} />, 
    fullscreen: <Maximize size={32} />, 
    exitFullscreen: <Minimize size={32} />,
    windowFullscreen: <AppWindow size={32} />,
    loopOn: <Repeat size={32} color="#38bdf8" />, 
    loopOff: <Repeat size={32} color="#64748b" />,
  };

  const showKeyboardActionHint = useCallback((iconKey) => {
    if (!iconKey) return;
    setKeyboardActionHint(iconKey);
    if (keyboardHintTimerRef.current) {
      clearTimeout(keyboardHintTimerRef.current);
      keyboardHintTimerRef.current = null;
    }
    keyboardHintTimerRef.current = setTimeout(() => {
      setKeyboardActionHint(null);
      keyboardHintTimerRef.current = null;
    }, 950);
  }, []);

  function restartVideo() {
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      video.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime || 0;
    setCurrentTime(t);

    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      const supportsPosition =
        typeof navigator.mediaSession.setPositionState === 'function';
      if (supportsPosition) {
        try {
          navigator.mediaSession.setPositionState({
            duration:
              Number.isFinite(video.duration) && video.duration > 0
                ? video.duration
                : currentDuration || 0,
            playbackRate: video.playbackRate || 1,
            position: t,
          });
        } catch {
          // ignore position errors
        }
      }
    }
  }

  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    if (Number.isFinite(video.duration)) {
      setCurrentDuration(Math.floor(video.duration));
    }
    // Detect portrait aspect ratio
    if (video.videoWidth && video.videoHeight) {
      setIsPortraitVideo(video.videoHeight > video.videoWidth);
      const ratio = video.videoWidth / video.videoHeight;
      if (Number.isFinite(ratio) && ratio > 0) {
        setVideoAspectRatio(ratio);
      }
    }
  }

  function handleVideoPlay() {
    setIsPlaying(true);
  }

  function handleVideoPause() {
    setIsPlaying(false);
  }

  function handleVideoEnded() {
    setIsPlaying(false);
    if (isLooping) {
      const video = videoRef.current;
      if (video) {
        video.currentTime = 0;
        video.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    } else {
      // Auto-play next video
      goToNextVideo();
    }
  }

  function handleSeek(event) {
    const video = videoRef.current;
    if (!video) return;
    const value = Number(event.target.value) || 0;
    video.currentTime = value;
    setCurrentTime(value);
  }

  const skipVideoRelative = useCallback((deltaSeconds) => {
    const video = videoRef.current;
    if (!video) return;
    const newTime = Math.max(0, video.currentTime + deltaSeconds);
    video.currentTime = newTime;
    setCurrentTime(newTime);
  }, []);

  const supportsFloatingWindow =
    typeof document !== 'undefined' &&
    !!document.pictureInPictureEnabled &&
    typeof HTMLVideoElement !== 'undefined' &&
    typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function';

  const canUseWindowFullscreen = !isMobileViewport;

  const toggleFloatingWindow = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !supportsFloatingWindow) return;

    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      // Ignore unsupported or blocked picture-in-picture transitions.
    }
  }, [supportsFloatingWindow]);

  const goToPreviousVideo = useCallback(() => {
    if (!sortedItems.length || selectedVideoId == null) return;
    const currentIdx = sortedItems.findIndex((item) => getItemId(item) === selectedVideoId);
    if (currentIdx <= 0) return;
    handlePlayVideo(sortedItems[currentIdx - 1]);
  }, [sortedItems, selectedVideoId]);

  const goToNextVideo = useCallback(() => {
    if (!sortedItems.length || selectedVideoId == null) return;
    const currentIdx = sortedItems.findIndex((item) => getItemId(item) === selectedVideoId);
    if (currentIdx < 0 || currentIdx >= sortedItems.length - 1) return;
    handlePlayVideo(sortedItems[currentIdx + 1]);
  }, [sortedItems, selectedVideoId]);

  const toggleWindowFullscreen = useCallback(() => {
    if (!canUseWindowFullscreen) return;
    setIsWindowFullscreen((prev) => {
      const next = !prev;
      if (next && getFullscreenElement()) {
        Promise.resolve(exitAnyFullscreen()).catch(() => {});
      }
      return next;
    });
  }, [canUseWindowFullscreen]);

  // Fullscreen API
  const toggleFullscreen = useCallback(() => {
    const container = videoContainerRef.current;
    if (!container) return;

    if (getFullscreenElement()) {
      Promise.resolve(exitAnyFullscreen()).catch(() => {});
    } else {
      if (isWindowFullscreen) setIsWindowFullscreen(false);

      Promise.resolve(requestElementFullscreen(container))
        .then(() => {
          // If element fullscreen is unavailable on this mobile browser,
          // fallback to native video fullscreen where supported (iOS/WebKit).
          if (!getFullscreenElement()) {
            const video = videoRef.current;
            if (video && typeof video.webkitEnterFullscreen === 'function') {
              try {
                video.webkitEnterFullscreen();
              } catch {
                // ignore unsupported native fullscreen transitions
              }
            }
          }
        })
        .catch(() => {});
    }
  }, [isWindowFullscreen]);

  const isVideoFullscreenView = isFullscreen || isWindowFullscreen;

  // Listen for fullscreen changes
  useEffect(() => {
    function handleFullscreenChange() {
      const fs = !!getFullscreenElement();
      setIsFullscreen(fs);
      if (fs) {
        setControlsVisible(true);
        resetHideTimer();
      } else {
        setControlsVisible(true);
        clearHideTimer();
      }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // iOS native video fullscreen does not always fire document fullscreen events.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function handleNativeFullscreenEnter() {
      setIsFullscreen(true);
      setControlsVisible(true);
      resetHideTimer();
    }

    function handleNativeFullscreenLeave() {
      if (!getFullscreenElement()) {
        setIsFullscreen(false);
        setControlsVisible(true);
        clearHideTimer();
      }
    }

    video.addEventListener('webkitbeginfullscreen', handleNativeFullscreenEnter);
    video.addEventListener('webkitendfullscreen', handleNativeFullscreenLeave);

    return () => {
      video.removeEventListener('webkitbeginfullscreen', handleNativeFullscreenEnter);
      video.removeEventListener('webkitendfullscreen', handleNativeFullscreenLeave);
    };
  }, [selectedVideoSource]);

  // Track mobile viewport capabilities so windowed fullscreen can be disabled on phones.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(hover: none) and (pointer: coarse)');

    const handleChange = () => {
      setIsMobileViewport(detectMobileViewport());
      setIsTouchInput(detectTouchInput());
    };

    handleChange();
    query.addEventListener('change', handleChange);
    return () => {
      query.removeEventListener('change', handleChange);
    };
  }, []);

  // Ensure windowed fullscreen is never active on mobile viewports.
  useEffect(() => {
    if (!canUseWindowFullscreen && isWindowFullscreen) {
      setIsWindowFullscreen(false);
    }
  }, [canUseWindowFullscreen, isWindowFullscreen]);

  // Prevent page scroll when app-level fullscreen overlay is active.
  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (!isWindowFullscreen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isWindowFullscreen]);

  // Keep floating-window UI state in sync with Picture-in-Picture events.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      setIsFloatingWindow(false);
      return;
    }

    function handlePiPEnter() {
      setIsFloatingWindow(true);
    }

    function handlePiPLeave() {
      setIsFloatingWindow(false);
    }

    video.addEventListener('enterpictureinpicture', handlePiPEnter);
    video.addEventListener('leavepictureinpicture', handlePiPLeave);

    return () => {
      video.removeEventListener('enterpictureinpicture', handlePiPEnter);
      video.removeEventListener('leavepictureinpicture', handlePiPLeave);
    };
  }, [selectedVideoSource]);

  // Idle-hide timer helpers for fullscreen controls
  function clearHideTimer() {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  function resetHideTimer() {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      if (getFullscreenElement() || isWindowFullscreen) {
        setControlsVisible(false);
      }
    }, 3000);
  }

  function handleContainerMouseMove() {
    if (!getFullscreenElement() && !isWindowFullscreen) return;
    setControlsVisible(true);
    resetHideTimer();
  }

  function handleVideoScreenTouchStart(event) {
    if (!isTouchInput || !isVideoFullscreenView) return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;

    fullscreenTouchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }

  function handleVideoScreenTouchEnd(event) {
    if (!isTouchInput || !isVideoFullscreenView) return;
    const start = fullscreenTouchStartRef.current;
    fullscreenTouchStartRef.current = null;
    if (!start) return;

    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Intentional vertical swipe only.
    if (absY < 48 || absY < absX * 1.2) return;

    if (deltaY > 0) {
      setControlsVisible(false);
      clearHideTimer();
      return;
    }

    setControlsVisible(true);
    resetHideTimer();
  }

  useEffect(() => {
    if (isWindowFullscreen) {
      setControlsVisible(true);
      resetHideTimer();
    } else if (!getFullscreenElement()) {
      setControlsVisible(true);
      clearHideTimer();
    }
  }, [isWindowFullscreen]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => clearHideTimer();
  }, []);

  useEffect(() => {
    return () => {
      if (keyboardHintTimerRef.current) {
        clearTimeout(keyboardHintTimerRef.current);
        keyboardHintTimerRef.current = null;
      }
    };
  }, []);

  // Wire keyboard controls for video playback.
  useEffect(() => {
    function handleKeyDown(event) {
      if (!sortedItems.length || !selectedVideo) return;

      const active = document.activeElement;
      if (isTypingElement(active)) {
        return;
      }

      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const key = event.key;

      if (key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        showKeyboardActionHint(isPlaying ? 'pause' : 'play');
        togglePlayPause();
        return;
      }

      const lower = typeof key === 'string' ? key.toLowerCase() : '';

      if (lower === 'c') {
        event.preventDefault();
        showKeyboardActionHint('prev');
        goToPreviousVideo();
        return;
      }

      if (lower === 'm') {
        event.preventDefault();
        showKeyboardActionHint('next');
        goToNextVideo();
        return;
      }

      if (lower === 'v') {
        event.preventDefault();
        showKeyboardActionHint('rewind');
        skipVideoRelative(-10);
        return;
      }

      if (lower === 'n') {
        event.preventDefault();
        showKeyboardActionHint('forward');
        skipVideoRelative(10);
        return;
      }

      if (lower === 'b') {
        event.preventDefault();
        showKeyboardActionHint('restart');
        restartVideo();
        return;
      }

      if (lower === 'f') {
        event.preventDefault();
        showKeyboardActionHint(isFullscreen ? 'exitFullscreen' : 'fullscreen');
        toggleFullscreen();
        return;
      }

      if (lower === 'w' && canUseWindowFullscreen) {
        event.preventDefault();
        showKeyboardActionHint('windowFullscreen');
        toggleWindowFullscreen();
        return;
      }

      if (lower === 'l') {
        event.preventDefault();
        showKeyboardActionHint(isLooping ? 'loopOff' : 'loopOn');
        toggleLooping();
        return;
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [sortedItems.length, selectedVideo, isPlaying, isFullscreen, isWindowFullscreen, isVideoFullscreenView, isLooping, canUseWindowFullscreen, showKeyboardActionHint, togglePlayPause, goToPreviousVideo, goToNextVideo, skipVideoRelative, toggleFullscreen, toggleWindowFullscreen, toggleLooping]);

  // Wire media session API for hardware/media key controls.
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
      const video = videoRef.current;
      if (!video) return;
      if (video.paused) {
        togglePlayPause();
      }
    });

    safeSet('pause', () => {
      const video = videoRef.current;
      if (!video) return;
      if (!video.paused) {
        togglePlayPause();
      }
    });

    safeSet('previoustrack', () => {
      goToPreviousVideo();
    });

    safeSet('nexttrack', () => {
      goToNextVideo();
    });

    safeSet('seekbackward', (details) => {
      const delta = (details && details.seekOffset) || 10;
      skipVideoRelative(-delta);
    });

    safeSet('seekforward', (details) => {
      const delta = (details && details.seekOffset) || 10;
      skipVideoRelative(delta);
    });

    safeSet('seekto', (details) => {
      if (!details || typeof details.seekTime !== 'number') return;
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = details.seekTime;
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
  }, [togglePlayPause, goToPreviousVideo, goToNextVideo, skipVideoRelative]);

  // Keep the browser/OS media controls (Media Session API) in sync
  // with the current video's metadata.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }

    if (!selectedVideo) {
      try {
        navigator.mediaSession.metadata = null;
      } catch {
        // ignore
      }
      return;
    }

    const title = pickTitle(selectedVideo);
    const album = pickFolderName(selectedVideo) || '';

    try {
      // eslint-disable-next-line no-undef
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist: 'Video',
        album,
        artwork: mediaSessionArtwork,
      });
    } catch {
      // Some environments reject artwork URLs. Retry with text-only metadata.
      try {
        // eslint-disable-next-line no-undef
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist: 'Video',
          album,
        });
      } catch {
        // Some browsers may not support MediaMetadata fully; fail silently.
      }
    }
  }, [selectedVideo, mediaSessionArtwork]);

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

  function handlePlayVideo(item) {
    const id = getItemId(item);
    setSelectedVideoId(id);
    setShouldAutoPlaySelectedVideo(true);
  }

  function scrollToCurrent() {
    if (!selectedVideo) return;

    function doScroll() {
      const domKey = getItemDomKey(selectedVideo);
      if (!domKey) return;
      const el = document.querySelector('[data-track-key="' + domKey + '"]');
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    if (groupByFolder) {
      const folderName = pickFolderName(selectedVideo) || 'Other';
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

  // Render a track item (used by both grouped and ungrouped lists)
  function renderTrackItem(item) {
    const key = String(getItemId(item) ?? item.__index ?? pickTitle(item));
    const title = pickTitle(item);
    const thumbUrl = pickThumbnailUrl(serverUrl, item);
    const domKey = getItemDomKey(item);
    const isActive =
      !!selectedVideo && getItemId(selectedVideo) === getItemId(item);

    return (
      <li className="music-item" key={key} data-track-key={domKey}>
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
          <div className="music-details">
            <div className="music-artist">{pickFolderName(item) || 'Video'}</div>
            <div className="music-meta">{pickDuration(item)}</div>
          </div>
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
  }

  return (
    <>
      <Header
        title={pageTitle}
        serverUrl={serverUrl}
        activeSection="video"
        onNavigate={onNavigate}
        onChangeServer={onChangeServer}
      />

      <main className="page">
        <section className="card full">
          {loading && <div className="info">Loading media from LocalStream...</div>}
          {error && !loading && <div className="error">{error}</div>}
          {!loading && !error && sortedItems.length === 0 && (
            <div className="info">{emptyText}</div>
          )}

          <div className="toolbar-row">
            <div className="search-row">
              <input
                type="search"
                placeholder="Search videos..."
                aria-label="Search media"
                value={searchQuery}
                ref={searchInputRef}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="sort-row">
              <label htmlFor="video-sort-select" className="sort-label">
                Sort by
              </label>
              <select
                id="video-sort-select"
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
              <button
                type="button"
                className={
                  'icon-button sort-icon-button sort-toggle' + (groupByFolder ? ' toggle-active' : '')
                }
                aria-pressed={groupByFolder ? 'true' : 'false'}
                aria-label="Toggle grouping by folder"
                onClick={() => setGroupByFolder((v) => !v)}
              >
                <Folder size={16} />
              </button>
            </div>
          </div>

          {/* Video display area — fullscreen container wraps both video + floating controls */}
          <section
            className={
              'video-player-container' +
              (isMobileViewport ? ' video-mobile-viewport' : '') +
              (isFullscreen ? ' video-player-fullscreen' : '') +
              (isWindowFullscreen ? ' video-player-window-fullscreen' : '') +
              (isVideoFullscreenView && isPortraitVideo ? ' video-portrait' : '') +
              (isVideoFullscreenView && !controlsVisible ? ' video-cursor-hidden' : '')
            }
            style={{ '--video-aspect-ratio': videoAspectRatio }}
            ref={videoContainerRef}
            hidden={!selectedVideo}
            onMouseMove={handleContainerMouseMove}
          >
            {selectedVideo && (
              <>
                <div
                  className="video-screen-area"
                  onTouchStart={handleVideoScreenTouchStart}
                  onTouchEnd={handleVideoScreenTouchEnd}
                >
                  <video
                    ref={videoRef}
                    src={selectedVideoSource}
                    preload="metadata"
                    poster={selectedVideoPoster || undefined}
                    loop={isLooping}
                    playsInline
                    webkit-playsinline="true"
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onPlay={handleVideoPlay}
                    onPause={handleVideoPause}
                    onEnded={handleVideoEnded}
                  />
                  {/* Play overlay when paused */}
                  {!isPlaying && (
                    <button
                      className="video-play-overlay"
                      type="button"
                      aria-label="Play video"
                      onClick={togglePlayPause}
                    >
                      <Play size={48} fill="currentColor" stroke="none" />
                    </button>
                  )}
                  {keyboardActionHint && (
                    <div className="video-shortcut-hint" role="status" aria-live="polite">
                      {actionIcons[keyboardActionHint]}
                    </div>
                  )}
                </div>

                {/* Player footer — floating bubble in fullscreen, normal footer otherwise */}
                <footer
                  className={
                    'player video-player-footer' +
                    (isVideoFullscreenView ? ' video-footer-floating' : '') +
                    (isVideoFullscreenView && !controlsVisible ? ' video-footer-hidden' : '')
                  }
                  id="video-player"
                  onMouseEnter={() => { if (isVideoFullscreenView) { setControlsVisible(true); clearHideTimer(); } }}
                  onMouseLeave={() => { if (isVideoFullscreenView) resetHideTimer(); }}
                >
                  {selectedVideo && (
                    <div
                      className="player-background"
                      style={{ backgroundImage: `url(${selectedVideoPoster})` }}
                    />
                  )}
                  <div className="player-overlay" />
                  <div className="player-content">
                    <div className="player-main">
                      {/* Removed player-art thumbnail in controller */}
                      <div className="player-info">
                        <div id="video-current-title" className="player-title">
                          <button
                            type="button"
                            className="player-title-button"
                            onClick={scrollToCurrent}
                          >
                            {selectedVideo ? pickTitle(selectedVideo) : ''}
                          </button>
                        </div>
                        <div id="video-current-folder" className="player-artist">
                          {selectedVideo ? pickFolderName(selectedVideo) : ''}
                        </div>
                      </div>
                    </div>
                    <div className="player-timeline" aria-label="Video playback timeline">
                      <span className="player-time">{formatTime(currentTime)}</span>
                      <input
                        type="range"
                        min="0"
                        max={currentDuration || 0}
                        step="1"
                        value={Math.min(currentTime, currentDuration || Number.MAX_SAFE_INTEGER)}
                        onChange={handleSeek}
                        onInput={handleSeek}
                        onTouchStart={(e) => e.stopPropagation()}
                        style={{ touchAction: 'none' }}
                      />
                      <span className="player-time">{formatTime(currentDuration)}</span>
                    </div>
                    <div className="player-controls-row">
                      <div className="player-left-actions" aria-label="Left controls">
                        <button
                          type="button"
                          className={`icon-button player-loop-button ${isLooping ? 'toggle-active' : ''}`}
                          aria-label={isLooping ? 'Loop on' : 'Loop off'}
                          title="Loop (L)"
                          onClick={toggleLooping}
                        >
                          <Repeat size={18} />
                        </button>
                        <button
                          type="button"
                          className={`icon-button player-floating-button ${isFloatingWindow ? 'toggle-active' : ''}`}
                          aria-label={isFloatingWindow ? 'Disable floating window' : 'Floating window'}
                          title={supportsFloatingWindow ? 'Floating window' : 'Floating window is not available'}
                          onClick={toggleFloatingWindow}
                          disabled={!supportsFloatingWindow}
                        >
                          <PictureInPicture2 size={18} />
                        </button>
                      </div>
                      <div className="player-controls" aria-label="Video playback controls">
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
                          id="video-play-pause"
                          type="button"
                          className="icon-button play-main"
                          aria-label={isPlaying ? 'Pause' : 'Play'}
                          onClick={togglePlayPause}
                        >
                          {isPlaying ? (
                            <Pause size={20} fill="currentColor" stroke="none" />
                          ) : (
                            <Play size={20} fill="currentColor" stroke="none" />
                          )}
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
                      <div className="player-side-actions" aria-label="View controls">
                        {canUseWindowFullscreen && (
                          <button
                            type="button"
                            className={`icon-button player-floating-button video-player-window-fullscreen-button ${isWindowFullscreen ? 'toggle-active' : ''}`}
                            aria-label={isWindowFullscreen ? 'Exit windowed fullscreen' : 'Windowed fullscreen'}
                            title="Windowed Fullscreen (W)"
                            onClick={toggleWindowFullscreen}
                          >
                            <AppWindow size={18} />
                          </button>
                        )}
                        <button
                          type="button"
                          className={`icon-button player-fullscreen-button ${isFullscreen ? 'toggle-active' : ''}`}
                          aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                          onClick={toggleFullscreen}
                        >
                          {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                        </button>
                      </div>
                    </div>
                  </div>
                </footer>
              </>
            )}
          </section>

          {/* Video list */}
          <div className="music-list-shell">
            {groupByFolder ? (
              <ul id="music-list" className="music-list" ref={musicListRef}>
                {groupKeys.map((groupKey) => (
                  <React.Fragment key={groupKey}>
                    <li className="folder-header">
                      <span className="folder-name">{groupKey}</span>
                      <button
                        type="button"
                        className="secondary folder-hide-button"
                        aria-label={
                          hiddenFolderSet.has(groupKey)
                            ? 'Show videos in this folder'
                            : 'Hide videos in this folder'
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
                        {hiddenFolderSet.has(groupKey) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </li>
                    {!hiddenFolderSet.has(groupKey) &&
                      groupedItems[groupKey].map((item) => renderTrackItem(item))}
                  </React.Fragment>
                ))}
              </ul>
            ) : (
              <ul className="music-list" aria-label="Video list" ref={musicListRef}>
                {sortedItems.map((item) => renderTrackItem(item))}
              </ul>
            )}
            <div className="music-side-rail">
              <button
                type="button"
                className="scroll-edge-button"
                aria-label="Scroll to top of list"
                onClick={() => {
                  const list = musicListRef.current;
                  if (list) list.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                disabled={items.length === 0}
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
                onClick={() => {
                  const list = musicListRef.current;
                  if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
                }}
                disabled={items.length === 0}
              >
                <ChevronDown size={16} />
              </button>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
