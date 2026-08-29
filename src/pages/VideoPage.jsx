import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { AudioLines, Play, Pause, Rewind, FastForward, SkipBack, SkipForward, Folder, ChevronUp, ChevronDown, ChevronLeft, Maximize, Minimize, PictureInPicture2, Repeat, AppWindow, Square, Delete, X, ArrowUp, ArrowDown, RefreshCw, Search } from 'lucide-react';

import { clearMediaCache, fetchMediaItemsCached, getMediaEndpoint } from '../functions/mediaApiCache.js';
import Header from '../components/Header.jsx';
import { SkeletonMediaItem } from '../components/Skeleton.jsx';
import VideoPlayer from '../components/VideoPlayer.jsx';
import FullscreenVideoPlayer from './FullscreenVideoPlayer.jsx';
import { useMediaPlayer } from '../functions/mediaService.js';
import MediaItem from '../components/MediaItem.jsx';
import { useQueue, applyQueueGrouping, getQueuePosition, dequeueNext, showToast } from '../functions/queueService.js';
import { NativeSelect, NativeSelectOption } from '../components/ui/native-select.jsx';
import { generateSpriteSheet, getCachedSprite } from '../functions/spriteSheetGenerator.js';
import {
  getItemId,
  pickTitle,
  pickDuration,
  pickThumbnailUrl,
  pickSourceUrl,
  filterItems,
  sortItems,
  sortFolderKeys,
  getMediaType,
  pickFolderName,
  pickDurationSeconds,
} from '../functions/mediaUtils.js';

const STORAGE_KEY = 'localstream_server_url';
const SETTINGS_KEY = 'localstream_video_settings';
const FORCE_NATIVE_FULLSCREEN_ON_APPLE = true;

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.hiddenFolders)) parsed.hiddenFolders = [];
      if (!parsed.sortKey || parsed.sortKey === 'original') parsed.sortKey = 'date';
      return parsed;
    }
  } catch {}
  return { sortKey: 'date', hiddenFolders: [] };
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



const VideoMarqueeText = ({ text, className, onClick, enabled = true }) => {
  const containerRef = useRef(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsOverflowing(false);
      return;
    }

    const checkOverflow = () => {
      const el = containerRef.current;
      if (el) {
        const isMarqueeActive = el.classList.contains('marquee');
        const scrollW = el.scrollWidth;
        const clientW = el.clientWidth;
        const actualTextWidth = isMarqueeActive ? (scrollW - clientW) : scrollW;
        const overflowing = actualTextWidth > clientW + 2;
        setIsOverflowing(overflowing);
      }
    };

    checkOverflow();
    const raf = requestAnimationFrame(checkOverflow);
    const timeout = setTimeout(checkOverflow, 160);

    window.addEventListener('resize', checkOverflow);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
      window.removeEventListener('resize', checkOverflow);
    };
  }, [text, enabled]);

  const marqueeClass = (enabled && isOverflowing) ? 'marquee' : '';

  if (onClick) {
    return (
      <button
        type="button"
        ref={containerRef}
        onClick={onClick}
        className={`${className} ${marqueeClass}`}
      >
        <span className="marquee-inner">{text}</span>
      </button>
    );
  }

  return (
    <div ref={containerRef} className={`${className} ${marqueeClass}`}>
      <span className="marquee-inner">{text}</span>
    </div>
  );
};



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

function normalizeDurationSeconds(raw, unit = 'seconds') {
  if (raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (unit === 'milliseconds') {
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
  const isMiniPhoneScreen = typeof window !== 'undefined' && (window.innerWidth <= 380 || window.innerHeight < 700);

  return uaDataMobile || uaMobile || (coarsePointer && touchScreen) || isMiniPhoneScreen;
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

function detectChromiumMobileBrowser() {
  if (typeof navigator === 'undefined') return false;

  const ua = String(navigator.userAgent || '');
  const isMobile = /Android|Mobile|iPhone|iPad|iPod/i.test(ua);
  if (!isMobile) return false;

  const isChromiumCore =
    /Chrome|Chromium|CriOS|EdgA|SamsungBrowser|OPR\//i.test(ua) &&
    !/Firefox|FxiOS/i.test(ua);

  return isChromiumCore;
}

function detectEdgeAndroidBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '');
  return /Android/i.test(ua) && /EdgA\//i.test(ua);
}

function detectChromiumBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '');
  return /Chrome|Chromium|Edg|OPR\//i.test(ua) && !/Firefox|FxiOS/.test(ua);
}


function detectAppleMobileDevice() {
  if (typeof navigator === 'undefined') return false;

  const ua = String(navigator.userAgent || '');
  const isiPhoneOrIPad = /iPhone|iPad|iPod/i.test(ua);
  const isiPadDesktopUa = /Macintosh/i.test(ua) && Number(navigator.maxTouchPoints || 0) > 1;

  return isiPhoneOrIPad || isiPadDesktopUa;
}

function detectWindowsOrLinux() {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '');
  return /Windows|Linux/i.test(ua) && !/Android|Windows Phone/i.test(ua);
}

function detectDesktopOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '');
  const isWindows = /Windows NT/i.test(ua) && !/Windows Phone/i.test(ua);
  const isiPad = /Macintosh/i.test(ua) && Number(navigator.maxTouchPoints || 0) > 1;
  const isMac = /Macintosh/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua) && !isiPad;
  const isLinux = /Linux/i.test(ua) && !/Android/i.test(ua);
  return isWindows || isMac || isLinux;
}

function collectCodecHintText(item) {
  if (!item) return '';

  const values = [
    item.codec,
    item.codecs,
    item.audioCodec,
    item.videoCodec,
    item.mime,
    item.mimeType,
    item.contentType,
    item.format,
    item.container,
    item.fileName,
    item.filename,
    item.name,
    item.path,
    item.filePath,
    item.fullPath,
    item.location,
  ];

  return values
    .filter(Boolean)
    .map((value) => String(value))
    .join(' ')
    .toLowerCase();
}

function buildAacChromiumRiskInfo(item, sourceUrl, hasAudioTrackLikely) {
  const hintText = collectCodecHintText(item);
  const src = String(sourceUrl || '').toLowerCase();
  const isMp4 = /\.mp4($|[?#])/.test(src) || /mp4/.test(hintText);
  const hasExplicitAac = /\baac\b|mp4a|m4a/.test(hintText);
  const hasSocialExportHint = /tiktok|capcut|reels|shorts/.test(hintText);
  const hasAudioHint = hasAudioTrackLikely || /audio|sound|voice|aac|mp4a|m4a/.test(hintText);

  const isRisk = (hasExplicitAac && isMp4) || (isMp4 && hasAudioHint) || (isMp4 && hasSocialExportHint);
  if (!isRisk) return null;

  if (hasExplicitAac) {
    return 'Detected AAC in MP4 metadata';
  }
  if (isMp4 && hasAudioHint) {
    return 'Detected MP4 with audio track (AAC commonly used)';
  }
  return 'Detected social-exported MP4 stream';
}

function getFullscreenElement() {
  if (typeof document === 'undefined') return null;

  return (
    document.fullscreenElement ||
    document.mozFullScreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement ||
    null
  );
}

function exitAnyFullscreen() {
  if (typeof document === 'undefined') return Promise.resolve();

  try {
    if (typeof document.exitFullscreen === 'function') {
      return Promise.resolve(document.exitFullscreen());
    }
    if (typeof document.mozCancelFullScreen === 'function') {
      return Promise.resolve(document.mozCancelFullScreen());
    }
    if (typeof document.webkitExitFullscreen === 'function') {
      return Promise.resolve(document.webkitExitFullscreen());
    }
    if (typeof document.msExitFullscreen === 'function') {
      return Promise.resolve(document.msExitFullscreen());
    }
  } catch (err) {
    return Promise.reject(err);
  }

  return Promise.resolve();
}

function requestElementFullscreen(el) {
  if (!el) return Promise.resolve();

  try {
    if (typeof el.requestFullscreen === 'function') {
      return Promise.resolve(el.requestFullscreen());
    }
    if (typeof el.mozRequestFullScreen === 'function') {
      return Promise.resolve(el.mozRequestFullScreen());
    }
    if (typeof el.webkitRequestFullscreen === 'function') {
      return Promise.resolve(el.webkitRequestFullscreen());
    }
    if (typeof el.msRequestFullscreen === 'function') {
      return Promise.resolve(el.msRequestFullscreen());
    }
  } catch (err) {
    return Promise.reject(err);
  }

  return Promise.resolve();
}

function getScreenOrientationController() {
  if (typeof screen === 'undefined' || !screen.orientation) return null;
  return screen.orientation;
}

async function tryLockScreenOrientation(mode) {
  const orientation = getScreenOrientationController();
  if (!orientation || typeof orientation.lock !== 'function') return false;

  try {
    await orientation.lock(mode);
    return true;
  } catch {
    return false;
  }
}

function tryUnlockScreenOrientation() {
  const orientation = getScreenOrientationController();
  if (!orientation || typeof orientation.unlock !== 'function') return;

  try {
    orientation.unlock();
  } catch {
    // ignore unlock failures
  }
}

const isElectron = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);

export default function VideoPage({
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
  const [items, setItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [sortKey, setSortKey] = useState(() => loadSettings().sortKey ?? 'date');
  const [isSortReversed, setIsSortReversed] = useState(() => loadSettings().isSortReversed ?? false);
  const [groupByFolder, setGroupByFolder] = useState(() => loadSettings().groupByFolder ?? true);
  const [hiddenFolders, setHiddenFolders] = useState(() => loadSettings().hiddenFolders ?? []);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [shouldAutoPlaySelectedVideo, setShouldAutoPlaySelectedVideo] = useState(false);
  const { queue, removeFromQueue, isItemQueued } = useQueue();

  // Player state (mirrors music player)
  const videoRef = useRef(null);
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
    togglePlayPause: baseTogglePlayPause,
    skipRelative: baseSkipRelative,
    seekTo: baseSeekTo,
  } = useMediaPlayer(videoRef);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(false);
  const [isFloatingWindow, setIsFloatingWindow] = useState(false);
  const [isVideoMinimized, setIsVideoMinimized] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isPortraitVideo, setIsPortraitVideo] = useState(false);
  const [hasVideoDimensions, setHasVideoDimensions] = useState(false);
  const [videoAspectRatio, setVideoAspectRatio] = useState(16 / 9);
  const [isLooping, setIsLooping] = useState(false);
  const [seekStatusMessage, setSeekStatusMessage] = useState('');
  const [keyboardActionHint, setKeyboardActionHint] = useState(null);
  const [isMobileViewport, setIsMobileViewport] = useState(() => detectMobileViewport());
  const [isTouchInput, setIsTouchInput] = useState(() => detectTouchInput());
  const [hasAudioTrackLikely, setHasAudioTrackLikely] = useState(false);
  const [isScrubbingTimeline, setIsScrubbingTimeline] = useState(false);
  const [scrubPreviewTime, setScrubPreviewTime] = useState(0);
  const [isSeekPreviewVisible, setIsSeekPreviewVisible] = useState(false);
  const [spriteSheet, setSpriteSheet] = useState(null);
  const spriteGenRef = useRef(null);
  const seekPreviewVideoRef = useRef(null);
  const videoContainerRef = useRef(null);
  const searchInputRef = useRef(null);
  const searchHistoryAddedRef = useRef(false);
  const windowFullscreenHistoryAddedRef = useRef(false);
  const hideTimerRef = useRef(null);
  const keyboardHintTimerRef = useRef(null);
  const musicListRef = useRef(null);
  const scrollTrackRef = useRef(null);
  const fullscreenTouchStartRef = useRef(null);
  const lastTapRef = useRef({ time: 0, x: 0 });
  const seekValidationTimerRef = useRef(null);
  const seekPreviewHideTimerRef = useRef(null);
  const seekPreviewSeekTimerRef = useRef(null);
  const bestKnownDurationRef = useRef(0);
  const wasFullscreenRef = useRef(false);
  const orientationLockedForLandscapeFullscreenRef = useRef(false);
  const autoLockAttemptedForCurrentSessionRef = useRef(false);
  const playbackStallRef = useRef({ time: 0, checks: 0 });
  const [isDraggingThumb, setIsDraggingThumb] = useState(false);
  const dragStartY = useRef(0);
  const dragStartScrollTop = useRef(0);
  const lastIncrementTimeRef = useRef(0);

  const isChromiumMobileBrowser = useMemo(() => detectChromiumMobileBrowser(), []);
  const isChromiumBrowser = useMemo(() => detectChromiumBrowser(), []);
  const isEdgeAndroidBrowser = useMemo(() => detectEdgeAndroidBrowser(), []);
  const isAppleMobileDevice = useMemo(() => detectAppleMobileDevice(), []);
  const isWinOrLinux = useMemo(() => detectWindowsOrLinux(), []);
  const isDesktop = useMemo(() => detectDesktopOS(), []);
  const shouldForceAppleNativeFullscreen = useMemo(() => {
    // Only force native Apple fullscreen if standard HTML5 Fullscreen API is unavailable.
    // iPhones (iOS) lack HTML5 Fullscreen on elements, while iPads (iPadOS) and Mac desktops support it.
    if (typeof document === 'undefined') return false;
    const hasStandardFullscreen =
      typeof document.exitFullscreen === 'function' ||
      typeof document.webkitExitFullscreen === 'function' ||
      typeof document.mozCancelFullScreen === 'function' ||
      typeof document.msExitFullscreen === 'function';
    return FORCE_NATIVE_FULLSCREEN_ON_APPLE && isAppleMobileDevice && !hasStandardFullscreen;
  }, [isAppleMobileDevice]);

  const [renderLimit, setRenderLimit] = useState(40);
  const [reloadNonce, setReloadNonce] = useState(0);

  const handleReload = useCallback(() => {
    if (!serverUrl) return;
    clearMediaCache(serverUrl);
    setReloadNonce((value) => value + 1);
    setSelectedVideoId(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setCurrentDuration(0);
    setBufferedTime(0);
    setIsLooping(false);
    setIsFullscreen(false);
    setIsWindowFullscreen(false);
    setIsFloatingWindow(false);
    setIsVideoMinimized(false);
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      exitDocumentFullscreen().catch(() => {});
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
      videoRef.current.load();
      videoRef.current.playbackRate = 1;
      videoRef.current.style.transform = 'none';
      videoRef.current.style.setProperty('object-fit', 'contain', 'important');
    }
  }, [serverUrl, setIsPlaying, setCurrentTime, setCurrentDuration, setBufferedTime]);

  const stopVideoPlayback = useCallback(() => {
    setSelectedVideoId(null);
    setShouldAutoPlaySelectedVideo(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setCurrentDuration(0);
    setBufferedTime(0);
    setIsLooping(false);
    setIsFullscreen(false);
    setIsWindowFullscreen(false);
    setIsFloatingWindow(false);
    setIsVideoMinimized(false);
    clearSeekPreviewHideTimer();
    clearSeekPreviewSeekTimer();
    setIsSeekPreviewVisible(false);
    bestKnownDurationRef.current = 0;
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      exitDocumentFullscreen().catch(() => {});
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
      videoRef.current.load();
      videoRef.current.playbackRate = 1;
      videoRef.current.style.transform = 'none';
      videoRef.current.style.setProperty('object-fit', 'contain', 'important');
    }
  }, [setIsPlaying, setCurrentTime, setCurrentDuration, setBufferedTime]);

  useEffect(() => {
    if (activePlaybackType === 'music') {
      stopVideoPlayback();
    }
  }, [activePlaybackType, stopVideoPlayback]);

  useEffect(() => {
    if (!isActivePage) {
      setIsFullscreen(false);
      setIsWindowFullscreen(false);
      setIsFloatingWindow(false);
      setIsVideoMinimized(false);
    }
  }, [isActivePage]);

  useEffect(() => {
    setRenderLimit(40);
  }, [searchQuery, sortKey, groupByFolder]);


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

  const handleScroll = useCallback(() => {
    updateScrollbar();
    const list = musicListRef.current;
    if (!list) return;
    const threshold = 600; 
    if (list.scrollHeight - list.scrollTop - list.clientHeight < threshold) {
      const now = Date.now();
      if (now - lastIncrementTimeRef.current > 300) {
        lastIncrementTimeRef.current = now;
        setRenderLimit(prev => prev + 30);
      }
    }
  }, [updateScrollbar]);

  useEffect(() => {
    const list = musicListRef.current;
    if (list) {
      list.addEventListener('scroll', handleScroll);
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
  }, [handleScroll, updateScrollbar, items, groupByFolder]);


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
  }, [serverUrl, reloadNonce]);

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


  // When a search is active, add a history entry so the back button clears
  // the search instead of navigating away.
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

  // When the video player is in windowed fullscreen, add a history entry so the
  // back button exits windowed fullscreen instead of navigating away.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isElectron) return;

    if (isWindowFullscreen && !windowFullscreenHistoryAddedRef.current) {
      const nextState = { ...(window.history.state || {}), __videoWindowFullscreen: true };
      window.history.pushState(nextState, '', window.location.pathname);
      windowFullscreenHistoryAddedRef.current = true;
    }

    if (!isWindowFullscreen && windowFullscreenHistoryAddedRef.current) {
      windowFullscreenHistoryAddedRef.current = false;
      if (window.history.state?.__videoWindowFullscreen) {
        window.history.back();
      }
    }
  }, [isWindowFullscreen]);

  useEffect(() => {
    if (isElectron) return;

    function handleWindowFullscreenPopState(e) {
      if (!isWindowFullscreen) return;

      const state = e.state || window.history.state;
      if (!state || !state.__videoWindowFullscreen) {
        setIsWindowFullscreen(false);
      }
    }

    window.addEventListener('popstate', handleWindowFullscreenPopState);
    return () => {
      window.removeEventListener('popstate', handleWindowFullscreenPopState);
    };
  }, [isWindowFullscreen]);

  const hiddenFolderSet = useMemo(() => new Set(hiddenFolders || []), [hiddenFolders]);

  const filtered = useMemo(() => filterItems(items, searchQuery), [items, searchQuery]);
  const sortedAllItems = useMemo(
    () => sortItems(items, sortKey, isSortReversed),
    [items, sortKey, isSortReversed]
  );
  const playbackItems = useMemo(() => {
    if (!groupByFolder) return sortedAllItems;

    const grouped = {};
    sortedAllItems.forEach((item) => {
      const folder = pickFolderName(item) || 'Other';
      if (!grouped[folder]) grouped[folder] = [];
      grouped[folder].push(item);
    });

    const folderNames = sortFolderKeys(Object.keys(grouped), sortedAllItems, sortKey, isSortReversed);

    const ordered = [];
    folderNames.forEach((folder) => {
      // Skip videos from hidden (collapsed) folders so they don't
      // appear in the playback queue (next/prev navigation).
      if (!hiddenFolderSet.has(folder)) {
        ordered.push(...grouped[folder]);
      }
    });
    return ordered;
  }, [sortedAllItems, groupByFolder, hiddenFolderSet, sortKey, isSortReversed]);
  const rawSortedItems = useMemo(
    () => sortItems(filtered, sortKey, isSortReversed),
    [filtered, sortKey, isSortReversed]
  );
  const sortedItems = useMemo(
    () => applyQueueGrouping(rawSortedItems, queue, isSortReversed),
    [rawSortedItems, queue, isSortReversed]
  );
  const groupedItems = useMemo(() => {
    if (!groupByFolder) return null;
    const map = {};
    rawSortedItems.forEach((item) => {
      const folder = isItemQueued(item) ? 'Queued' : (pickFolderName(item) || 'Other');
      if (!map[folder]) map[folder] = [];
      map[folder].push(item);
    });
    if (map['Queued']) {
      map['Queued'].sort((a, b) => getQueuePosition(a) - getQueuePosition(b));
    }
    return map;
  }, [rawSortedItems, groupByFolder, queue, isItemQueued]);

  const groupKeys = useMemo(() => {
    if (!groupByFolder || !groupedItems) return [];
    const keys = Object.keys(groupedItems).filter((k) => k !== 'Queued');
    const sortedKeys = sortFolderKeys(keys, rawSortedItems, sortKey, isSortReversed);

    if (groupedItems['Queued']) {
      if (isSortReversed) {
        // Arrow UP: Queued folder at the VERY TOP!
        return ['Queued', ...sortedKeys];
      } else {
        // Arrow DOWN: Queued folder at the VERY BOTTOM!
        return [...sortedKeys, 'Queued'];
      }
    }

    return sortedKeys;
  }, [groupedItems, groupByFolder, rawSortedItems, sortKey, isSortReversed]);

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

  const selectedVideo = useMemo(() => {
    if (!items.length || selectedVideoId == null) return null;
    const found = items.find((item) => getItemId(item) === selectedVideoId);
    return found || null;
  }, [items, selectedVideoId]);

  useEffect(() => {
    if (activePlaybackType !== 'video') return;
    onPlaybackChange?.(selectedVideo ? {
      type: 'video', item: selectedVideo, currentTime, duration: currentDuration, isPlaying,
    } : null);
  }, [activePlaybackType, selectedVideo, currentTime, currentDuration, isPlaying, onPlaybackChange]);

  const selectedVideoSource = useMemo(
    () => (selectedVideo ? pickSourceUrl(serverUrl, selectedVideo) : ''),
    [serverUrl, selectedVideo]
  );

  const selectedVideoPoster = useMemo(
    () => (selectedVideo ? pickThumbnailUrl(serverUrl, selectedVideo) : ''),
    [serverUrl, selectedVideo]
  );

  // Generate or retrieve cached sprite sheet for the currently selected video
  useEffect(() => {
    if (!selectedVideoSource) {
      setSpriteSheet(null);
      return;
    }

    const cached = getCachedSprite(selectedVideoSource);
    if (cached) {
      setSpriteSheet(cached);
      return;
    }

    setSpriteSheet(null);
    const ctrl = generateSpriteSheet(selectedVideoSource);
    spriteGenRef.current = ctrl;

    ctrl.promise
      .then((sheet) => {
        if (sheet) {
          setSpriteSheet(sheet);
        }
      })
      .catch(() => {});

    return () => {
      if (ctrl) ctrl.cancel();
    };
  }, [selectedVideoSource]);

  const aacChromiumRiskReason = useMemo(
    () => buildAacChromiumRiskInfo(selectedVideo, selectedVideoSource, hasAudioTrackLikely),
    [selectedVideo, selectedVideoSource, hasAudioTrackLikely]
  );

  const isAacChromiumRisk = isChromiumMobileBrowser && !!aacChromiumRiskReason;
  const isEdgeAndroidAacRisk = isEdgeAndroidBrowser && !!aacChromiumRiskReason;

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
      setBufferedTime(0);
      setCurrentDuration(0);
      clearSeekPreviewHideTimer();
      clearSeekPreviewSeekTimer();
      setIsSeekPreviewVisible(false);
      bestKnownDurationRef.current = 0;
      setHasVideoDimensions(false);
      setVideoAspectRatio(16 / 9);
      return;
    }
    setCurrentTime(0);
    setBufferedTime(0);
    setIsPlaying(false);
    setSeekStatusMessage('');
    setHasAudioTrackLikely(false);
    setIsScrubbingTimeline(false);
    setScrubPreviewTime(0);
    clearSeekPreviewHideTimer();
    clearSeekPreviewSeekTimer();
    setIsSeekPreviewVisible(false);
    setHasVideoDimensions(false);
    const metaDuration = pickDurationSeconds(selectedVideo);
    bestKnownDurationRef.current = metaDuration || 0;
    setCurrentDuration(metaDuration || 0);
  }, [selectedVideo]);

  // Generate sprite sheet for seek preview when video source changes.
  useEffect(() => {
    // Cancel any in-flight generation.
    if (spriteGenRef.current) {
      spriteGenRef.current.cancel();
      spriteGenRef.current = null;
    }

    if (!selectedVideoSource) {
      setSpriteSheet(null);
      return;
    }

    // Check cache first.
    const cached = getCachedSprite(selectedVideoSource);
    if (cached) {
      setSpriteSheet(cached);
      return;
    }

    // Start background generation.
    const ctrl = generateSpriteSheet(selectedVideoSource);
    spriteGenRef.current = ctrl;

    ctrl.promise.then((result) => {
      // Only apply if this is still the active generation.
      if (spriteGenRef.current === ctrl) {
        setSpriteSheet(result);
        spriteGenRef.current = null;
      }
    });

    return () => {
      if (spriteGenRef.current === ctrl) {
        ctrl.cancel();
        spriteGenRef.current = null;
      }
    };
  }, [selectedVideoSource]);

  function adoptDuration(rawDurationSeconds) {
    const duration = Number(rawDurationSeconds);
    if (!Number.isFinite(duration) || duration <= 0) return false;

    const rounded = Math.max(1, Math.floor(duration));
    if (rounded > bestKnownDurationRef.current) {
      bestKnownDurationRef.current = rounded;
    }

    setCurrentDuration((prev) => Math.max(prev || 0, rounded));
    return true;
  }

  function clearSeekValidationTimer() {
    if (!seekValidationTimerRef.current) return;
    clearTimeout(seekValidationTimerRef.current);
    seekValidationTimerRef.current = null;
  }

  function clearSeekPreviewHideTimer() {
    if (!seekPreviewHideTimerRef.current) return;
    clearTimeout(seekPreviewHideTimerRef.current);
    seekPreviewHideTimerRef.current = null;
  }

  function clearSeekPreviewSeekTimer() {
    if (!seekPreviewSeekTimerRef.current) return;
    clearTimeout(seekPreviewSeekTimerRef.current);
    seekPreviewSeekTimerRef.current = null;
  }

  function showSeekPreview() {
    clearSeekPreviewHideTimer();
    setIsSeekPreviewVisible(true);
  }

  function hideSeekPreviewSoon() {
    clearSeekPreviewHideTimer();
    seekPreviewHideTimerRef.current = setTimeout(() => {
      setIsSeekPreviewVisible(false);
      seekPreviewHideTimerRef.current = null;
    }, 700);
  }

  const seekVideoTo = useCallback((rawTargetSeconds, showFailureHint) => {
    const video = videoRef.current;
    if (!video) return;

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const clamped = duration > 0
      ? Math.min(duration, Math.max(0, Number(rawTargetSeconds) || 0))
      : Math.max(0, Number(rawTargetSeconds) || 0);

    try {
      video.currentTime = clamped;
    } catch {
      // Ignore hard seek failures from browser internals.
    }

    setCurrentTime(clamped);
    if (!showFailureHint) return;

    clearSeekValidationTimer();
    seekValidationTimerRef.current = setTimeout(() => {
      const actual = Number(video.currentTime) || 0;
      const drift = Math.abs(actual - clamped);
      const driftThreshold = isAacChromiumRisk ? 0.8 : 1.5;
      if (drift > driftThreshold) {
        setSeekStatusMessage(
          isAacChromiumRisk
            ? 'Chromium mobile compatibility issue detected: AAC/MP4 seek can be blocked. Use native player fallback for reliable scrubbing.'
            : 'Seek may be limited for this file on Chromium Android (often AAC/MP4 muxing). Try fullscreen native player as fallback.'
        );
        return;
      }
      setSeekStatusMessage('');
    }, isAacChromiumRisk ? 260 : 320);
  }, [isAacChromiumRisk]);

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isPlaying || video.paused) {
      if (!video.paused && !isPlaying) {
        video.pause();
      }
      video.play().catch(() => setIsPlaying(false));
    } else {
      video.pause();
    }
  }, [isPlaying]);

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
      video.play().catch(() => setIsPlaying(false));
    }
  }



  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime || 0;
    if (!isScrubbingTimeline) {
      setCurrentTime(t);
    }
    updateBufferedTime();

    if (!hasAudioTrackLikely && Number(video.webkitAudioDecodedByteCount || 0) > 0) {
      setHasAudioTrackLikely(true);
    }

    if (!adoptDuration(video.duration) && bestKnownDurationRef.current > 0) {
      setCurrentDuration((prev) => Math.max(prev || 0, bestKnownDurationRef.current));
    }

    if (activePlaybackType === 'video' && typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
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
    if (!adoptDuration(video.duration) && bestKnownDurationRef.current > 0) {
      setCurrentDuration((prev) => Math.max(prev || 0, bestKnownDurationRef.current));
    }
    updateBufferedTime();

    if (video.audioTracks && Number(video.audioTracks.length || 0) > 0) {
      setHasAudioTrackLikely(true);
    } else if (typeof video.mozHasAudio === 'boolean') {
      setHasAudioTrackLikely(video.mozHasAudio);
    }

    const hasDimensions = Number(video.videoWidth) > 0 && Number(video.videoHeight) > 0;
    setHasVideoDimensions(hasDimensions);

    // Detect portrait aspect ratio
    if (hasDimensions) {
      setIsPortraitVideo(video.videoHeight > video.videoWidth);
      const ratio = video.videoWidth / video.videoHeight;
      if (Number.isFinite(ratio) && ratio > 0) {
        setVideoAspectRatio(ratio);
      }
    }
  }

  function handleDurationChange() {
    const video = videoRef.current;
    if (!video) return;

    if (!adoptDuration(video.duration) && bestKnownDurationRef.current > 0) {
      setCurrentDuration((prev) => Math.max(prev || 0, bestKnownDurationRef.current));
    }
    updateBufferedTime();
  }

  function handleProgress() {
    updateBufferedTime();
  }

  function tryEnterAppleNativeFullscreen(video) {
    if (!video || !shouldForceAppleNativeFullscreen) return;
    if (typeof video.webkitEnterFullscreen !== 'function') return;

    if (typeof video.webkitDisplayingFullscreen === 'boolean' && video.webkitDisplayingFullscreen) {
      return;
    }

    if (typeof video.webkitSupportsFullscreen === 'boolean' && !video.webkitSupportsFullscreen) {
      return;
    }

    try {
      video.webkitEnterFullscreen();
    } catch {
      // Ignore blocked transitions when browser denies fullscreen in this context.
    }
  }

  function handleVideoPlay(event) {
    onStartPlayback?.('video');
    const video = videoRef.current;
    playbackStallRef.current = {
      time: event?.currentTarget?.currentTime || event?.target?.currentTime || video?.currentTime || 0,
      checks: 0,
    };
    setIsPlaying(true);
    // Removed auto fullscreen on play for iOS; fullscreen is now only triggered by the fullscreen button
  }

  function handleVideoPause() {
    playbackStallRef.current = { time: 0, checks: 0 };
    setIsPlaying(false);
  }

  function handleVideoEnded() {
    const video = videoRef.current;

    setIsPlaying(false);
    if (isLooping) {
      if (video) {
        video.currentTime = 0;
        video.play().catch(() => setIsPlaying(false));
      }
    } else {
      // Auto-play next video
      goToNextVideo();
    }
  }

  // On some mobile browsers, when another app takes audio focus (e.g. playing
  // a song from Spotify/YouTube Music), the OS interrupts the <video> element
  // without firing a 'pause' event.  The <audio> element used by the music page
  // fires the event reliably, but <video> does not on all devices.
  // This effect periodically checks the actual paused state of the video element
  // and syncs isPlaying if they drift apart.
  useEffect(() => {
    if (!selectedVideo) return;

    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      if (video.paused && isPlaying) {
        setIsPlaying(false);
      }
    }, 500);

    return () => clearInterval(id);
  }, [selectedVideo, isPlaying]);

  function clampSeekValue(rawValue) {
    const n = Number(rawValue) || 0;
    const max = Number.isFinite(currentDuration) && currentDuration > 0 ? currentDuration : 0;
    return Math.min(max, Math.max(0, n));
  }

  function beginTimelineScrub() {
    showSeekPreview();
    setIsScrubbingTimeline(true);
    setScrubPreviewTime(currentTime || 0);
  }

  function handleSeekPreview(event) {
    const value = clampSeekValue(event.target.value);
    showSeekPreview();
    setScrubPreviewTime(value);
    if (!isScrubbingTimeline) {
      seekVideoTo(value, true);
      hideSeekPreviewSoon();
    } else {
      // YouTube style: only update the sprite preview while dragging the slider,
      // not the main video (which would cause severe network lag).
    }
  }

  function commitTimelineSeek(targetValue) {
    const finalValue = clampSeekValue(targetValue);
    seekVideoTo(finalValue, true);
    setScrubPreviewTime(finalValue);
    setIsScrubbingTimeline(false);
    hideSeekPreviewSoon();
  }

  function handleSeekChange(event) {
    const value = clampSeekValue(event.target.value);
    if (isScrubbingTimeline) {
      showSeekPreview();
      setScrubPreviewTime(value);
      return;
    }
    showSeekPreview();
    seekVideoTo(value, true);
    setScrubPreviewTime(value);
    hideSeekPreviewSoon();
  }

  function handleSeekHover(event) {
    // Disabled hover preview per user request.
    // The sprite sheet/preview overlay will only update and show when clicking and dragging (scrubbing).
  }

  function handleSeekMouseLeave() {
    if (isTouchInput) return;
    if (!isScrubbingTimeline) {
      hideSeekPreviewSoon();
      // Do not snap back immediately to currentTime, let it fade out at hover spot
    }
  }

  function endTimelineScrub() {
    if (!isScrubbingTimeline) return;
    commitTimelineSeek(scrubPreviewTime);
  }

  useEffect(() => {
    const previewVideo = seekPreviewVideoRef.current;
    if (!previewVideo || !selectedVideoSource || !isSeekPreviewVisible) return;

    const targetTime = clampSeekValue(scrubPreviewTime);
    let loadedMetadataHandler = null;

    const applyPreviewTime = () => {
      try {
        previewVideo.pause();
        previewVideo.muted = true;
        previewVideo.currentTime = targetTime;
      } catch {
        // Some browsers reject rapid preview seeks while metadata is loading.
      }
    };

    if (previewVideo.readyState >= 1) {
      applyPreviewTime();
    } else {
      loadedMetadataHandler = applyPreviewTime;
      previewVideo.addEventListener('loadedmetadata', loadedMetadataHandler, { once: true });
      previewVideo.load();
    }

    return () => {
      if (loadedMetadataHandler) {
        previewVideo.removeEventListener('loadedmetadata', loadedMetadataHandler);
      }
    };
  }, [scrubPreviewTime, currentDuration, isSeekPreviewVisible, selectedVideoSource]);

  const skipVideoRelative = useCallback((deltaSeconds) => {
    const video = videoRef.current;
    if (!video) return;
    const newTime = Math.max(0, video.currentTime + deltaSeconds);
    seekVideoTo(newTime, false);
  }, [seekVideoTo]);

  // Firefox exposes requestPictureInPicture() on HTMLVideoElement but reports
  // document.pictureInPictureEnabled as false — checking for the method alone
  // is the reliable cross-browser feature-detection approach.
  const supportsFloatingWindow =
    typeof document !== 'undefined' &&
    typeof HTMLVideoElement !== 'undefined' &&
    typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function';

  // Windowed fullscreen is only useful on true desktop platforms. Samsung DeX
  // in Chrome may report a desktop-class UA string ("Linux x86_64") which
  // fools detectDesktopOS(), so we additionally check for mobile signals:
  // navigator.userAgentData.mobile, Android/iPhone/iPad in the UA, and the
  const canUseWindowFullscreen = useMemo(() => {
    if (!isDesktop) return false;
    
    // Explicit Android/iOS/iPadOS detection via UA
    const ua = String(navigator.userAgent || '');
    if (/Android|iPhone|iPad|iPod/i.test(ua)) return false;
    
    if (navigator.userAgentData) {
      if (navigator.userAgentData.mobile) return false;
      if (navigator.userAgentData.platform === 'Android') return false;
    }
    
    // iPadOS with desktop UA: Macintosh + multitouch
    if (/Macintosh/i.test(ua) && Number(navigator.maxTouchPoints || 0) > 1) return false;

    // Samsung DeX in desktop mode heavily spoofs the UA to look exactly like Desktop Linux
    // ("X11; Linux x86_64"). However, we can distinguish genuine desktop Chromium from 
    // Android Chromium by checking for desktop-exclusive hardware APIs that are disabled 
    // on Android, such as Web Serial (navigator.serial) or Web HID (navigator.hid).
    const isChromium = /Chrome/i.test(ua) && !/Edge|Edg/i.test(ua) && !/OPR|Opera/i.test(ua);
    if (isChromium && /Linux/i.test(ua)) {
      if (typeof navigator !== 'undefined' && !('serial' in navigator)) {
        // If it's "Linux Chrome" but lacks navigator.serial, it's almost certainly Android DeX.
        return false;
      }
    }

    return true;
  }, [isDesktop]);

  // True mobile device = genuine phone or tablet (Android, iOS), NOT Samsung DeX or desktops or Electron.
  // Used to gate mobile-only controls like the miniplayer and manual screen rotation button.
  const isTrueMobileDevice = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const ua = String(navigator.userAgent || '');
    if (/electron/i.test(ua)) return false;

    // userAgentData.mobile is the most reliable signal (Chromium 90+).
    // Samsung DeX reports mobile=false; genuine phone/tablet reports true.
    if (navigator.userAgentData) {
      if (navigator.userAgentData.mobile === true) return true;
    }
    // Fallback for Safari and non-Chromium browsers (no userAgentData)
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    // iPadOS desktop-mode UA: "Macintosh" + multitouch
    if (/Macintosh/i.test(ua) && Number(navigator.maxTouchPoints || 0) > 1) return true;
    if (/Android/i.test(ua)) return true;
    return false;
  }, []);

  useEffect(() => {
    const checkMinimizable = () => {
      const isLargeScreen = typeof window !== 'undefined' && window.innerWidth >= 701;
      if ((!isTrueMobileDevice || isLargeScreen) && isVideoMinimized) {
        setIsVideoMinimized(false);
      }
    };
    checkMinimizable();
    window.addEventListener('resize', checkMinimizable);
    return () => window.removeEventListener('resize', checkMinimizable);
  }, [isTrueMobileDevice, isVideoMinimized]);

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
    const list = playbackItems.length ? playbackItems : sortedAllItems;
    if (!list.length || selectedVideoId == null) return;
    let currentIdx = list.findIndex((item) => getItemId(item) === selectedVideoId);
    if (currentIdx < 0) {
      const allIdx = sortedAllItems.findIndex((item) => getItemId(item) === selectedVideoId);
      if (allIdx >= 0) {
        const prevInList = [...sortedAllItems.slice(0, allIdx)].reverse().find((it) =>
          list.some((p) => getItemId(p) === getItemId(it))
        );
        if (prevInList) {
          const foundIdx = list.findIndex((p) => getItemId(p) === getItemId(prevInList));
          if (foundIdx >= 0) {
            handlePlayVideo(list[foundIdx]);
            return;
          }
        }
      }
      handlePlayVideo(list[list.length - 1]);
      return;
    }
    if (currentIdx > 0) {
      handlePlayVideo(list[currentIdx - 1]);
    }
  }, [playbackItems, sortedAllItems, selectedVideoId]);

  const goToNextVideo = useCallback(() => {
    const queued = dequeueNext();
    if (queued) {
      handlePlayVideo(queued);
      return;
    }
    const list = playbackItems.length ? playbackItems : sortedAllItems;
    if (!list.length || selectedVideoId == null) return;
    let currentIdx = list.findIndex((item) => getItemId(item) === selectedVideoId);
    if (currentIdx < 0) {
      const allIdx = sortedAllItems.findIndex((item) => getItemId(item) === selectedVideoId);
      if (allIdx >= 0) {
        const nextInList = sortedAllItems.slice(allIdx + 1).find((it) =>
          list.some((p) => getItemId(p) === getItemId(it))
        );
        if (nextInList) {
          const foundIdx = list.findIndex((p) => getItemId(p) === getItemId(nextInList));
          if (foundIdx >= 0) {
            handlePlayVideo(list[foundIdx]);
            return;
          }
        }
      }
      handlePlayVideo(list[0]);
      return;
    }
    if (currentIdx < list.length - 1) {
      handlePlayVideo(list[currentIdx + 1]);
    }
  }, [playbackItems, sortedAllItems, selectedVideoId]);

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

  const handleManualRotate = useCallback(() => {
    const orientation = getScreenOrientationController();
    if (!orientation) return;

    const currentType = orientation.type || '';
    if (currentType.startsWith('landscape')) {
      Promise.resolve(tryLockScreenOrientation('portrait-primary'))
        .then((locked) => {
          if (locked) {
            orientationLockedForLandscapeFullscreenRef.current = false;
          }
        })
        .catch(() => {});
    } else {
      Promise.resolve(tryLockScreenOrientation('landscape'))
        .then((locked) => {
          if (locked) {
            orientationLockedForLandscapeFullscreenRef.current = true;
          }
        })
        .catch(() => {});
    }
  }, []);

  // Fullscreen API
  const toggleFullscreen = useCallback(async () => {
    const container = videoContainerRef.current;
    if (!container) return;

    // Force iOS native fullscreen if on Apple mobile device
    if (shouldForceAppleNativeFullscreen) {
      const video = videoRef.current;
      tryEnterAppleNativeFullscreen(video);
      return;
    }

    try {
      if (getFullscreenElement()) {
        if (orientationLockedForLandscapeFullscreenRef.current) {
          try {
            await tryLockScreenOrientation('portrait-primary');
          } catch {
            // ignore orientation lock failures
          }
        }
        await exitAnyFullscreen();
      } else {
        if (isWindowFullscreen) setIsWindowFullscreen(false);

        try {
          await requestElementFullscreen(container);
          
          // If element fullscreen is unavailable on this browser/device,
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
        } catch (fullscreenError) {
          console.warn('Standard HTML5 fullscreen request failed, falling back to windowed fullscreen:', fullscreenError);
          setIsWindowFullscreen(true);
        }
      }
    } catch (err) {
      console.error('Fullscreen operation failed:', err);
    }
  }, [isWindowFullscreen, shouldForceAppleNativeFullscreen]);

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

  // Lock orientation based on the video that starts the fullscreen session.
  // Do not re-evaluate orientation when the current clip changes while fullscreen is active.
  useEffect(() => {
    if (!isMobileViewport) return;

    const enteredFullscreen = isFullscreen && !wasFullscreenRef.current;
    const exitedFullscreen = !isFullscreen && wasFullscreenRef.current;

    if (enteredFullscreen) {
      wasFullscreenRef.current = true;
      autoLockAttemptedForCurrentSessionRef.current = false;
    }

    if (isFullscreen) {
      if (!autoLockAttemptedForCurrentSessionRef.current && hasVideoDimensions) {
        const shouldLockLandscape = !isWindowFullscreen && !isPortraitVideo;
        if (shouldLockLandscape) {
          autoLockAttemptedForCurrentSessionRef.current = true;
          Promise.resolve(tryLockScreenOrientation('landscape'))
            .then((locked) => {
              if (locked) {
                orientationLockedForLandscapeFullscreenRef.current = true;
              }
            })
            .catch(() => {});
        } else {
          // Metadata is here but it's portrait or windowed; we've "checked" it for this session.
          autoLockAttemptedForCurrentSessionRef.current = true;
        }
      }
      return;
    }

    if (isFullscreen) return;

    if (exitedFullscreen) {
      wasFullscreenRef.current = false;

      if (!orientationLockedForLandscapeFullscreenRef.current) return;

      orientationLockedForLandscapeFullscreenRef.current = false;
      Promise.resolve(tryLockScreenOrientation('portrait-primary')).catch(() => {});
    }
  }, [isFullscreen, isWindowFullscreen, isMobileViewport, hasVideoDimensions, isPortraitVideo]);

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
    if (!isPlaying) {
      return;
    }
    hideTimerRef.current = setTimeout(() => {
      if (getFullscreenElement() || isFullscreen || isWindowFullscreen) {
        setControlsVisible(false);
      }
    }, 3000);
  }

  useEffect(() => {
    if (!isPlaying) {
      clearHideTimer();
    }
  }, [isPlaying]);

  function handleContainerMouseMove() {
    if (!getFullscreenElement() && !isFullscreen && !isWindowFullscreen) return;
    setControlsVisible(true);
    if (isPlaying) {
      resetHideTimer();
    }
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

    try {
      event.preventDefault();
    } catch (e) {}
    try {
      event.stopPropagation();
    } catch (e) {}

    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absX < 30 && absY < 30) {
      const now = Date.now();
      const lastTap = lastTapRef.current;
      const timeSinceLastTap = now - lastTap.time;

      if (timeSinceLastTap < 300) {
        setControlsVisible(false);
        clearHideTimer();

        if (touch.clientX < window.innerWidth / 3) {
          skipVideoRelative(-10);
          showKeyboardActionHint('rewind');
        } else if (touch.clientX > (window.innerWidth * 2) / 3) {
          skipVideoRelative(10);
          showKeyboardActionHint('forward');
        }
        lastTapRef.current = { time: 0, x: 0 };
        return;
      } else {
        lastTapRef.current = { time: now, x: touch.clientX };
      }
    }

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
    return () => {
      clearHideTimer();
      wasFullscreenRef.current = false;
      orientationLockedForLandscapeFullscreenRef.current = false;
      tryUnlockScreenOrientation();
    };
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
    if (!isActivePage) return;

    function handleKeyDown(event) {
      if (!playbackItems.length || !selectedVideo) return;

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

      if (lower === 'p' && supportsFloatingWindow) {
        event.preventDefault();
        showKeyboardActionHint('floatingWindow');
        toggleFloatingWindow();
        return;
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isActivePage, playbackItems.length, selectedVideo, isPlaying, isFullscreen, isWindowFullscreen, isVideoFullscreenView, isLooping, canUseWindowFullscreen, supportsFloatingWindow, toggleFloatingWindow, showKeyboardActionHint, togglePlayPause, goToPreviousVideo, goToNextVideo, skipVideoRelative, toggleFullscreen, toggleWindowFullscreen, toggleLooping]);

  // Wire media session API for hardware/media key controls.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    if (activePlaybackType !== 'video') {
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
      seekVideoTo(details.seekTime, false);
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
  }, [activePlaybackType, togglePlayPause, goToPreviousVideo, goToNextVideo, skipVideoRelative]);

  useEffect(() => {
    return () => {
      clearSeekValidationTimer();
      clearSeekPreviewHideTimer();
      clearSeekPreviewSeekTimer();
    };
  }, []);

  useEffect(() => {
    if (!isPlaying || !selectedVideo) {
      playbackStallRef.current = { time: 0, checks: 0 };
      return;
    }

    const intervalId = window.setInterval(() => {
      const video = videoRef.current;
      if (!video) return;

      if (video.paused || video.ended) {
        setIsPlaying(false);
        playbackStallRef.current = { time: 0, checks: 0 };
        return;
      }

      if (video.seeking || isScrubbingTimeline || video.playbackRate === 0) {
        playbackStallRef.current = {
          time: video.currentTime || 0,
          checks: 0,
        };
        return;
      }

      const current = video.currentTime || 0;
      const previous = playbackStallRef.current.time || 0;
      const advanced = Math.abs(current - previous) > 0.05;

      if (advanced) {
        playbackStallRef.current = { time: current, checks: 0 };
        return;
      }

      let bufferedAhead = 0;
      const buffered = video.buffered;
      for (let i = 0; buffered && i < buffered.length; i += 1) {
        if (buffered.start(i) <= current && current <= buffered.end(i)) {
          bufferedAhead = buffered.end(i) - current;
          break;
        }
      }

      if (video.readyState < 3 || bufferedAhead < 1) {
        playbackStallRef.current = { time: current, checks: 0 };
        return;
      }

      const checks = playbackStallRef.current.checks + 1;
      playbackStallRef.current = { time: current, checks };

      if (checks >= 3) {
        video.pause();
        setIsPlaying(false);
        playbackStallRef.current = { time: current, checks: 0 };
      }
    }, 500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isPlaying, selectedVideo, isScrubbingTimeline]);

  // Keep the browser/OS media controls (Media Session API) in sync
  // with the current video's metadata.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    if (activePlaybackType !== 'video') {
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
  }, [activePlaybackType, selectedVideo, mediaSessionArtwork]);

  // Reflect play/pause state in the Media Session API.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    if (activePlaybackType !== 'video') {
      return;
    }
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch {
      // ignore
    }
  }, [activePlaybackType, isPlaying]);

  function handlePlayVideo(item) {
    onStartPlayback?.('video');
    if (isItemQueued(item)) {
      removeFromQueue(item, true);
    }
    const id = getItemId(item);
    setSelectedVideoId(id);
    setShouldAutoPlaySelectedVideo(true);
    setIsVideoMinimized(false);
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

    let needsRenderUpdate = false;

    if (searchQuery) {
      setSearchQuery('');
      needsRenderUpdate = true;
    }

    const targetId = getItemId(selectedVideo);

    if (groupByFolder) {
      const folderName = pickFolderName(selectedVideo) || 'Other';
      
      const allGroupedMap = {};
      sortedAllItems.forEach((item) => {
        const folder = pickFolderName(item) || 'Other';
        if (!allGroupedMap[folder]) allGroupedMap[folder] = [];
        allGroupedMap[folder].push(item);
      });
      
      const groupItems = allGroupedMap[folderName] || [];
      const idxInGroup = groupItems.findIndex((it) => getItemId(it) === targetId);
      if (idxInGroup >= renderLimit) {
        setRenderLimit(idxInGroup + 50);
        needsRenderUpdate = true;
      }
    } else {
      const idxInSorted = sortedAllItems.findIndex((it) => getItemId(it) === targetId);
      if (idxInSorted >= renderLimit) {
        setRenderLimit(idxInSorted + 50);
        needsRenderUpdate = true;
      }
    }

    if (groupByFolder) {
      const folderName = pickFolderName(selectedVideo) || 'Other';
      if (hiddenFolderSet.has(folderName)) {
        setHiddenFolders((prev) =>
          (Array.isArray(prev) ? prev : []).filter((name) => name !== folderName)
        );
        needsRenderUpdate = true;
      }
    }

    if (needsRenderUpdate) {
      setTimeout(doScroll, 100);
    } else {
      doScroll();
    }
  }



  const seekPreviewLeftPercent =
    currentDuration > 0
      ? Math.min(100, Math.max(0, (scrubPreviewTime / currentDuration) * 100))
      : 0;
  const seekPreviewLeft =
    `clamp(var(--seek-preview-half-width), ${seekPreviewLeftPercent}%, calc(100% - var(--seek-preview-half-width)))`;

  // Render a track item (used by both grouped and ungrouped lists)
  function renderTrackItem(item) {
    const isActive =
      !!selectedVideo && getItemId(selectedVideo) === getItemId(item);

    return (
      <MediaItem
        key={getItemDomKey(item) || (getItemId(item) ?? item.__index)}
        item={item}
        isActive={isActive}
        isPlayingActive={isActive && isPlaying}
        groupByFolder={groupByFolder}
        serverUrl={serverUrl}
        onSelect={handlePlayVideo}
      />
    );
  }


  return (
    <div className="media-page-container">
      <Header
        title={pageTitle}
        serverUrl={serverUrl}
        activeSection="video"
        onNavigate={onNavigate}
        onChangeServer={onChangeServer}
        reloadNonce={reloadNonce}
        isActivePage={isActivePage}
        playbackSnapshot={playbackSnapshot}
      />

      <main className={
        'page video-page' +
        (selectedVideo ? ' has-playing' : '') +
        (isVideoMinimized && isTrueMobileDevice ? ' video-player-minimized-active' : '') +
        (isVideoFullscreenView ? ' video-player-active' : '')
      }>
        <section className={
          'card full video-player-card' +
          (selectedVideo ? ' has-playing' : '')
        }>
          {loading && <div className="info">Loading media from LocalStream...</div>}
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

          {!loading && !error && sortedItems.length === 0 && (
            <div className="info">{emptyText}</div>
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
                  type="search"
                  placeholder="Search videos..."
                  aria-label="Search media"
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
              <label htmlFor="video-sort-select" className="sort-label">
                Sort by
              </label>
              <NativeSelect
                id="video-sort-select"
                aria-label="Sort media list"
                value={sortKey}
                onChange={(e) => {
                  const val = e.target.value || 'date';
                  setSortKey(val);
                  const labels = { date: 'Date', name: 'Name', duration: 'Duration' };
                  const label = labels[val] || (val ? val.charAt(0).toUpperCase() + val.slice(1) : 'Date');
                  showToast({ action: 'sort', message: `Sort by: ${label}` });
                }}
                style={{ minWidth: '6.5rem' }}
              >
                <NativeSelectOption value="date">Date</NativeSelectOption>
                <NativeSelectOption value="name">Name</NativeSelectOption>
                <NativeSelectOption value="duration">Duration</NativeSelectOption>
              </NativeSelect>
              <button
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

          <VideoPlayer
            selectedVideo={selectedVideo}
            pickTitle={pickTitle}
            pickFolderName={pickFolderName}
            isMobileViewport={isMobileViewport}
            isEdgeAndroidBrowser={isEdgeAndroidBrowser}
            isFullscreen={isFullscreen}
            isWindowFullscreen={isWindowFullscreen}
            isVideoFullscreenView={isVideoFullscreenView}
            reloadNonce={reloadNonce}
            onMinimizeToggle={(val) => {
              if (!isTrueMobileDevice) return;
              setIsVideoMinimized(typeof val === 'boolean' ? val : !isVideoMinimized);
            }}
            isVideoMinimized={isVideoMinimized && isTrueMobileDevice}
            isPortraitVideo={isPortraitVideo}
            controlsVisible={controlsVisible}
            setControlsVisible={setControlsVisible}
            clearHideTimer={clearHideTimer}
            resetHideTimer={resetHideTimer}
            videoAspectRatio={videoAspectRatio}
            videoContainerRef={videoContainerRef}
            handleContainerMouseMove={handleContainerMouseMove}
            handleVideoScreenTouchStart={handleVideoScreenTouchStart}
            handleVideoScreenTouchEnd={handleVideoScreenTouchEnd}
            videoRef={videoRef}
            selectedVideoSource={selectedVideoSource}
            selectedVideoPoster={selectedVideoPoster}
            isLooping={isLooping}
            handleTimeUpdate={handleTimeUpdate}
            handleLoadedMetadata={handleLoadedMetadata}
            handleDurationChange={handleDurationChange}
            handleProgress={handleProgress}
            bufferedTime={bufferedTime}
            handleVideoPlay={handleVideoPlay}
            handleVideoPause={handleVideoPause}
            handleVideoEnded={handleVideoEnded}
            keyboardActionHint={keyboardActionHint}
            actionIcons={actionIcons}
            MarqueeTextComponent={VideoMarqueeText}
            scrollToCurrent={scrollToCurrent}
            currentTime={currentTime}
            scrubPreviewTime={scrubPreviewTime}
            isScrubbingTimeline={isScrubbingTimeline}
            currentDuration={currentDuration}
            seekPreviewLeft={seekPreviewLeft}
            isSeekPreviewVisible={isSeekPreviewVisible}
            seekPreviewVideoRef={seekPreviewVideoRef}
            handleSeekChange={handleSeekChange}
            handleSeekPreview={handleSeekPreview}
            beginTimelineScrub={beginTimelineScrub}
            endTimelineScrub={endTimelineScrub}
            handleSeekHover={handleSeekHover}
            handleSeekMouseLeave={handleSeekMouseLeave}
            hideSeekPreviewSoon={hideSeekPreviewSoon}
            isTouchInput={isTouchInput}
            formatTime={formatTime}
            isFloatingWindow={isFloatingWindow}
            toggleLooping={toggleLooping}
            toggleFloatingWindow={toggleFloatingWindow}
            supportsFloatingWindow={supportsFloatingWindow}
            skipVideoRelative={skipVideoRelative}
            goToPreviousVideo={goToPreviousVideo}
            goToNextVideo={goToNextVideo}
            isPlaying={isPlaying}
            togglePlayPause={togglePlayPause}
            isWinOrLinux={isWinOrLinux}
            handleManualRotate={handleManualRotate}
            canUseWindowFullscreen={canUseWindowFullscreen}
            toggleWindowFullscreen={toggleWindowFullscreen}
            toggleFullscreen={toggleFullscreen}
            isChromiumBrowser={isChromiumBrowser}
            isTrueMobileDevice={isTrueMobileDevice}
            spriteSheet={spriteSheet}
          />

          {/* Video list */}
          <div className="music-list-shell">
            {loading && items.length === 0 ? (
              <ul className="music-list" aria-label="Loading videos">
                {Array.from({ length: 12 }).map((_, i) => (
                  <SkeletonMediaItem key={`loading-skel-${i}`} />
                ))}
              </ul>
            ) : (
              <ul id="music-list" className="music-list" ref={musicListRef} aria-label={groupByFolder ? "Video list grouped by folder" : "Video list"}>
                {(() => {
                  let renderedCount = 0;
                  const itemsToRenderLimit = renderLimit;

                  if (groupByFolder) {
                    return (
                      <>
                        <li className="folder-header">
                          <span className="folder-name">All</span>
                          <button
                            type="button"
                            className="secondary folder-hide-button"
                            aria-label={areAllFoldersHidden ? 'Show all folders' : 'Hide all folders'}
                            onClick={toggleAllFolders}
                          >
                            {areAllFoldersHidden ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </li>
                        {groupKeys.map((groupKey) => {
                          const groupItems = (groupedItems && groupedItems[groupKey]) || [];
                          const isQueued = groupKey === 'Queued';
                          const isHidden = !isQueued && hiddenFolderSet.has(groupKey);
                          const remainingLimit = Math.max(0, itemsToRenderLimit - renderedCount);
                          const visibleItems = isHidden ? [] : groupItems.slice(0, remainingLimit);
                          renderedCount += visibleItems.length;

                          return (
                            <React.Fragment key={groupKey}>
                              <li className="folder-header">
                                <span className="folder-name">{groupKey} ({groupItems.length})</span>
                                {!isQueued && (
                                  <button
                                    type="button"
                                    className="secondary folder-hide-button"
                                    aria-label={isHidden ? 'Show videos in this folder' : 'Hide videos in this folder'}
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
                                    {isHidden ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                  </button>
                                )}
                              </li>
                              {!isHidden && visibleItems.map(renderTrackItem)}
                            </React.Fragment>
                          );
                        })}
                      </>
                    );
                  } else {
                    const visibleItems = sortedItems.slice(0, itemsToRenderLimit);
                    return visibleItems.map(renderTrackItem);
                  }
                })()}
                {renderLimit < (groupByFolder ? filtered.length : sortedItems.length) && (
                  <>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <SkeletonMediaItem key={`skel-bottom-${i}`} />
                    ))}
                  </>
                )}
              </ul>
            )}

            <div className="music-side-rail">
              <button
                type="button"
                className="scroll-edge-button"
                aria-label="Scroll to top of list"
                onClick={() => {
                  const list = musicListRef.current;
                  if (!list) return;
                  setRenderLimit(40);
                  list.scrollTo({ top: 0, behavior: 'smooth' });
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
                  if (!list) return;
                  const total = (sortedItems && sortedItems.length) || items.length;
                  setRenderLimit(total);
                  setTimeout(() => {
                    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
                  }, 0);
                }}
                disabled={items.length === 0}
              >
                <ChevronDown size={16} />
              </button>

            </div>
          </div>

        </section>
      </main>
    </div>
  );
}
