import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Shuffle,
  Repeat,
  SkipBack,
  SkipForward,
  Rewind,
  FastForward,
  MicOff,
  Search,
  AudioLines,
  Disc,
} from 'lucide-react';
import { MorphIcon } from 'morphicons/react';
import {
  Play as MorphPlay,
  Pause as MorphPause,
  Search as MorphSearch,
  RefreshCw as MorphRefresh,
  X as MorphX,
  EyeOff as MorphEyeOff,
  Maximize2 as MorphMaximize2,
  Minimize2 as MorphMinimize2,
} from 'lucide';
import { ClipLoader } from 'react-spinners';
import AnimatedMediaButton from './AnimatedMediaButton.jsx';
import {
  fetchLyrics,
  cleanTrackTitle,
  parseTrackAndArtist,
  searchLyrics,
  getSearchSuggestions,
  getCachedSearchResults,
  getTrackShortlist,
  saveTrackShortlist,
  limitSearchQueryInput,
  normalizeText,
  formatCandidateResult,
  saveSessionLyrics,
  getSessionLyrics,
  saveSelectedLyrics,
  getSelectedLyrics,
  unlinkLyricsForTrack,
  clearLyricsCache,
} from '../functions/lyricsService.js';
import { pickPathTitle } from '../functions/mediaUtils.js';
import './LyricsView.css';

const REALTIME_SYNC_KEY = 'localstream_lyrics_realtime_sync';
const SEARCH_DEBOUNCE_MS = 350;
const LYRICS_SEARCH_TIMEOUT_MS = 30000;
const MIN_LYRICS_DURATION_SECONDS = 90;
const LYRICS_TIMEOUT_MESSAGE = 'Lyrics not found. The search timed out after 30 seconds.';
const LYRICS_SEARCH_FAILED_MESSAGE = 'Lyrics not found. Check your connection and try again.';
const LYRICS_TOO_SHORT_MESSAGE = 'Lyrics are unavailable for tracks shorter than 1 minute 30 seconds.';
const LYRICS_UNLINKED_MESSAGE = 'Lyrics not found. This track is unlinked. Search manually to link lyrics again.';
const MANUAL_SEARCH_TIMEOUT_MESSAGE = 'No lyrics found. The search timed out after 30 seconds.';
const MANUAL_SEARCH_FAILED_MESSAGE = 'Search failed. Check your connection and try again.';

const LYRICS_SOURCE_LABELS = {
  lrclib: 'LRCLIB',
  binilyrics: 'BiniLyrics',
  'lrc.red': 'lrc.red',
  betterlyrics: 'BetterLyrics',
  'betterlyrics-qq': 'BetterLyrics (QQ)',
  'betterlyrics-kugou': 'BetterLyrics (Kugou)',
  lyricsplus: 'LyricsPlus',
  'youtube-music': 'YouTube Music',
  musicbrainz: 'MusicBrainz',
};

// Attribution links per source. BiniLyrics is now lrc.red (same project,
// renamed); the BetterLyrics API serves betterlyrics.org; the LyricsPlus
// mirrors expose no project page, so the first mirror's own landing page is
// the most truthful "where it came from" target.
const LYRICS_SOURCE_URLS = {
  lrclib: 'https://lrclib.net',
  binilyrics: 'https://lrc.red',
  'lrc.red': 'https://lrc.red',
  betterlyrics: 'https://betterlyrics.org',
  'betterlyrics-qq': 'https://betterlyrics.org',
  'betterlyrics-kugou': 'https://betterlyrics.org',
  lyricsplus: 'https://lyricsplus.prjktla.my.id',
  'youtube-music': 'https://music.youtube.com',
  musicbrainz: 'https://musicbrainz.org',
};

function formatLyricsSource(source) {
  return LYRICS_SOURCE_LABELS[source] || '';
}

/** Stable identity for a search candidate, used when merging cached lists. */
function getCandidateKey(item) {
  if (!item) return '';
  if (item.id) return `id:${item.id}`;
  return [
    normalizeText(item.name || item.trackName || ''),
    normalizeText(item.artistName || ''),
    normalizeText(item.albumName || ''),
    Math.round(Number(item.duration) || 0),
  ].join('|');
}

/** Merges candidate lists (first list wins) without showing duplicates. */
function mergeCandidateLists(...lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists) {
    for (const item of list || []) {
      const key = getCandidateKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

function isLyricsTrackTooShort(duration) {
  const seconds = Number(duration);
  return Number.isFinite(seconds) && seconds > 0 && seconds < MIN_LYRICS_DURATION_SECONDS;
}

function loadRealtimeSyncEnabled() {
  try {
    const stored = window.localStorage.getItem(REALTIME_SYNC_KEY);
    return stored == null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export default function LyricsView({
  currentlyPlaying,
  currentArtUrl,
  displayArtUrl,
  defaultArt,
  isArtZoomed: propArtZoomed,
  setIsArtZoomed: propSetIsArtZoomed,
  currentTime = 0,
  currentDuration = 0,
  bufferedTime = 0,
  isPlaying,
  isRepeat,
  setIsRepeat,
  isShuffle,
  setIsShuffle,
  handleSeek,
  togglePlayPause,
  playPreviousTrack,
  playNextTrack,
  skipRelative,
  formatTime,
  isClosing = false,
  onCloseLyrics,
  onExitToSmallPlayer,
  audioRef,
  pickTitle,
  pickArtist,
  pickDurationSeconds,
}) {
  const [localArtZoomed, setLocalArtZoomed] = useState(false);
  const isArtZoomed = propArtZoomed !== undefined ? propArtZoomed : localArtZoomed;
  const setIsArtZoomed = propSetIsArtZoomed || setLocalArtZoomed;

  const [lyricsData, setLyricsData] = useState({
    loading: true,
    synced: false,
    lines: [],
    instrumental: false,
    error: null,
    unlinked: false,
    trackName: '',
    artistName: '',
  });

  const [currentActiveLyricIndex, setCurrentActiveLyricIndex] = useState(-1);
  const [isRealtimeSync, setIsRealtimeSync] = useState(loadRealtimeSyncEnabled);
  const [isUnlinkingLyrics, setIsUnlinkingLyrics] = useState(false);
  const [isManualSearchOpen, setIsManualSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [searchError, setSearchError] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const searchDebounceRef = useRef(null);
  const searchContainerRef = useRef(null);
  const searchRequestRef = useRef(0);
  const searchQueryDirtyRef = useRef(false);
  const searchAbortRef = useRef(null);
  const lyricsRequestRef = useRef(0);
  const lyricsAbortRef = useRef(null);
  const manualSelectionRef = useRef(null);
  const semanticWarmupStartedRef = useRef(false);

  const lyricsScrollRef = useRef(null);
  const lineRefs = useRef([]);
  const userScrollingRef = useRef(false);
  const userScrollTimeoutRef = useRef(null);
  const scrollAnimRef = useRef(null);

  // Timeline Scrubbing Refs
  const playedRef = useRef(null);
  const rangeInputRef = useRef(null);
  const timeTextRef = useRef(null);
  const isScrubbingRef = useRef(false);

  const effectiveDur = currentDuration || (currentlyPlaying && pickDurationSeconds ? pickDurationSeconds(currentlyPlaying) : 0) || 0;
  const effectiveTime = audioRef?.current && Number.isFinite(audioRef.current.currentTime) ? audioRef.current.currentTime : currentTime;

  const currentTitle = currentlyPlaying ? (pickTitle ? pickTitle(currentlyPlaying) : currentlyPlaying.title || '') : '';
  const currentArtist = currentlyPlaying ? (pickArtist ? pickArtist(currentlyPlaying) : currentlyPlaying.artist || '') : '';
  const parsedCurrent = parseTrackAndArtist(currentTitle, currentArtist);
  // Files with broken ID3 tags often still have the original "Artist - Title"
  // filename. Use that label as the preferred search query when it looks like
  // a real track, so automatic lookup and the manual search box agree.
  const pathTitle = currentlyPlaying ? pickPathTitle(currentlyPlaying) : '';
  const parsedPath = pathTitle ? parseTrackAndArtist(pathTitle, '') : null;
  const pathLabelUsable = Boolean(
    pathTitle
    && parsedPath?.title
    && parsedPath?.artist
    && /[\p{L}]/u.test(parsedPath.title)
    && /[\p{L}]/u.test(parsedPath.artist)
    && !/^(?:audio|song|track|video)\s*\d*$/i.test(parsedPath.title)
    && !/^(?:audio|song|track|video)\s*\d*$/i.test(parsedPath.artist),
  );
  const pathLookupLabel = pathLabelUsable ? pathTitle : '';
  // The file's own tag/filename is the source of truth for the player label.
  // Lyrics metadata is only a payload: a wrong automatic match must never
  // rename the track that is actually playing.
  const displayTitle = currentTitle || parsedCurrent.title || cleanTrackTitle(lyricsData.trackName);
  const displayArtist = currentArtist || parsedCurrent.artist || lyricsData.artistName;
  // Build from parsed metadata rather than raw title + artist so a filename
  // like "Rick Astley - Never Gonna Give You Up (Video)" does not become
  // "Rick Astley - Never Gonna Give You Up Rick Astley" or carry a stale
  // search from the previously played track.
  const metadataSearchQuery = parsedCurrent.artist && parsedCurrent.title
    ? `${parsedCurrent.artist} - ${parsedCurrent.title}`
    : [currentTitle, currentArtist].filter(Boolean).join(' ')
      || parsedCurrent.title
      || cleanTrackTitle(currentTitle);
  const trackSearchQuery = pathLookupLabel || metadataSearchQuery;
  const artSrc = displayArtUrl || currentArtUrl || defaultArt;

  // The match the player is actually showing. The search popup displays this
  // first, so opening it never hides which result is in use while a fresh
  // search is still running.
  const currentLyricsMatch = !lyricsData.loading
    && (lyricsData.instrumental || (lyricsData.lines?.length > 0))
    ? {
      trackName: lyricsData.trackName || displayTitle,
      artistName: lyricsData.artistName || displayArtist,
      source: lyricsData.source || '',
      synced: Boolean(lyricsData.synced),
      instrumental: Boolean(lyricsData.instrumental),
      duration: effectiveDur,
    }
    : null;

  // ── 1. Fetch Lyrics on track change ──────────────────────────────────────────────
  const loadLyrics = useCallback(async (title, artist, duration, forceRefresh = false, lookupHint = '') => {
    if (!title) return;

    // Any new lookup supersedes the previous one, including its network calls.
    if (lyricsAbortRef.current) {
      lyricsAbortRef.current.abort();
      lyricsAbortRef.current = null;
    }

    const requestId = lyricsRequestRef.current + 1;
    lyricsRequestRef.current = requestId;
    const isCurrentRequest = () => lyricsRequestRef.current === requestId;

    // A manual choice is authoritative for the current track. This also stops
    // automatic lookup from restarting when the duration arrives a moment later.
    const manualSelection = manualSelectionRef.current;
    if (
      !forceRefresh
      && manualSelection
      && manualSelection.title === title
      && (manualSelection.artist || '') === (artist || '')
    ) {
      if (!isCurrentRequest()) return;
      setLyricsData({ ...manualSelection.data, loading: false });
      return;
    }

    if (!forceRefresh) {
      // A clip/intro shorter than 1 minute 30 seconds should not display an
      // automatic match found before its duration was known, or a cached
      // result from a previous session. Manual search remains available.
      if (isLyricsTrackTooShort(duration)) {
        if (!isCurrentRequest()) return;
        setLyricsData({
          loading: false,
          synced: false,
          lines: [],
          instrumental: false,
          error: LYRICS_TOO_SHORT_MESSAGE,
          unlinked: false,
          trackName: cleanTrackTitle(title) || title,
          artistName: artist,
        });
        return;
      }

      const selectedLyrics = getSelectedLyrics(title, artist, lookupHint);
      if (selectedLyrics && (selectedLyrics.lines?.length > 0 || selectedLyrics.instrumental)) {
        if (!isCurrentRequest()) return;
        setLyricsData({
          loading: false,
          synced: Boolean(selectedLyrics.synced),
          lines: selectedLyrics.lines || [],
          instrumental: Boolean(selectedLyrics.instrumental),
          error: selectedLyrics.error || null,
          unlinked: false,
          trackName: cleanTrackTitle(selectedLyrics.trackName) || selectedLyrics.trackName || title,
          artistName: selectedLyrics.artistName || artist,
          source: selectedLyrics.source || '',
        });
        return;
      }

      const sessionCached = getSessionLyrics(title, artist, lookupHint);
      if (sessionCached && (sessionCached.lines?.length > 0 || sessionCached.instrumental)) {
        if (!isCurrentRequest()) return;
        setLyricsData({
          loading: false,
          synced: Boolean(sessionCached.synced),
          lines: sessionCached.lines || [],
          instrumental: Boolean(sessionCached.instrumental),
          error: sessionCached.error || null,
          unlinked: false,
          trackName: cleanTrackTitle(sessionCached.trackName) || sessionCached.trackName || title,
          artistName: sessionCached.artistName || artist,
          source: sessionCached.source || '',
        });
        return;
      }
    }

    const controller = new AbortController();
    lyricsAbortRef.current = controller;
    let timedOut = false;
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
        const timeoutError = new Error('Lyrics search timed out');
        timeoutError.name = 'AbortError';
        reject(timeoutError);
      }, LYRICS_SEARCH_TIMEOUT_MS);
    });

    setLyricsData((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await Promise.race([
        fetchLyrics(
          title,
          artist,
          duration,
          forceRefresh,
          lookupHint,
          controller.signal,
        ),
        timeoutPromise,
      ]);
      if (!isCurrentRequest()) return;
      if (res) {
        const cleanName = cleanTrackTitle(res.trackName) || res.trackName || title;
        const resultData = {
          loading: false,
          synced: Boolean(res.synced),
          lines: res.lines || [],
          instrumental: Boolean(res.instrumental),
          error: res.error || null,
          unlinked: Boolean(res.unlinked),
          trackName: cleanName,
          artistName: res.artistName || artist,
          source: res.source || '',
        };
        setLyricsData(resultData);
        saveSessionLyrics(title, artist, resultData);
      } else {
        setLyricsData({
          loading: false,
          synced: false,
          lines: [],
          instrumental: false,
          error: 'No lyrics found for this track.',
          unlinked: false,
          trackName: title,
          artistName: artist,
        });
      }
    } catch (err) {
      if (!isCurrentRequest()) return;
      setLyricsData({
        loading: false,
        synced: false,
        lines: [],
        instrumental: false,
        error: timedOut ? LYRICS_TIMEOUT_MESSAGE : LYRICS_SEARCH_FAILED_MESSAGE,
        unlinked: false,
        trackName: title,
        artistName: artist,
      });
    } finally {
      window.clearTimeout(timeoutId);
      if (lyricsAbortRef.current === controller) {
        lyricsAbortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (!currentlyPlaying) {
      if (lyricsAbortRef.current) {
        lyricsAbortRef.current.abort();
        lyricsAbortRef.current = null;
      }
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
        searchAbortRef.current = null;
      }
      return;
    }
    const parsed = parseTrackAndArtist(currentTitle, currentArtist);
    const mediaTitle = cleanTrackTitle(currentTitle) || parsed.title;
    const mediaArtist = currentArtist || parsed.artist;
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }
    lyricsRequestRef.current += 1;
    setLyricsData({
      loading: true,
      synced: false,
      lines: [],
      instrumental: false,
      error: null,
      unlinked: false,
      trackName: mediaTitle,
      artistName: mediaArtist,
    });
    setSearchQuery(trackSearchQuery);
    searchQueryDirtyRef.current = false;
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    searchRequestRef.current += 1;
    setIsSearching(false);
    setIsManualSearchOpen(false);
    setSearchResults(null);
    setSearchSuggestions([]);
    setSearchError('');
    lineRefs.current = [];
    setCurrentActiveLyricIndex(-1);
    loadLyrics(currentTitle, currentArtist, effectiveDur, false, pathLookupLabel);
  }, [currentlyPlaying, currentTitle, currentArtist, effectiveDur, loadLyrics, trackSearchQuery, pathLookupLabel]);

  // ── Scope in-memory caches to the Lyrics View session ──────────────────────
  // Forget search results and parsed lyrics when the view is closed, so the
  // next visit starts clean instead of serving stale shortlists.
  useEffect(() => {
    return () => clearLyricsCache();
  }, []);

  // ── 2. Time-Sync Detection Loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isRealtimeSync || !lyricsData.lines || lyricsData.lines.length === 0) return;

    let animId;
    const updateSync = () => {
      const audio = audioRef?.current;
      const audioTime = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : currentTime;

      let activeIdx = -1;
      for (let i = 0; i < lyricsData.lines.length; i++) {
        const lineTime = lyricsData.lines[i].time;
        if (lineTime != null && audioTime >= lineTime) {
          activeIdx = i;
        } else if (lineTime != null && audioTime < lineTime) {
          break;
        }
      }

      if (activeIdx !== currentActiveLyricIndex) {
        setCurrentActiveLyricIndex(activeIdx);
      }
      animId = requestAnimationFrame(updateSync);
    };

    animId = requestAnimationFrame(updateSync);
    return () => cancelAnimationFrame(animId);
  }, [isRealtimeSync, lyricsData.lines, currentActiveLyricIndex, audioRef, currentTime]);

  // ── 3. Smooth Auto-Scroll with User Interaction Detection ───────────────────────
  const stopScrollAnimation = useCallback(() => {
    if (scrollAnimRef.current) {
      cancelAnimationFrame(scrollAnimRef.current);
      scrollAnimRef.current = null;
    }
  }, []);

  // Custom eased scroll. Unlike native `behavior: 'smooth'` (fixed duration,
  // cannot be redirected or interrupted), this picks up from the current
  // scrollTop on every line change, so consecutive jumps feel continuous.
  const animateScrollTo = useCallback(
    (targetTop) => {
      const container = lyricsScrollRef.current;
      if (!container) return;
      stopScrollAnimation();
      const maxY = container.scrollHeight - container.clientHeight;
      const endTop = Math.max(0, Math.min(targetTop, maxY));
      const startTop = container.scrollTop;
      const delta = endTop - startTop;
      if (Math.abs(delta) < 0.5) return;

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        container.style.scrollBehavior = 'auto';
        container.scrollTop = endTop;
        container.style.scrollBehavior = '';
        return;
      }

      // Short hops snap quickly; long catch-ups get a little more time
      const duration = Math.min(640, 300 + Math.abs(delta) * 0.22);
      const startTime = performance.now();
      const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
      const step = (now) => {
        const p = Math.min(1, (now - startTime) / duration);
        container.scrollTop = startTop + delta * easeOutQuint(p);
        if (p < 1) {
          scrollAnimRef.current = requestAnimationFrame(step);
        } else {
          scrollAnimRef.current = null;
        }
      };
      scrollAnimRef.current = requestAnimationFrame(step);
    },
    [stopScrollAnimation],
  );

  const handleUserScroll = () => {
    // Real interaction (wheel / touch drag) always wins over the auto-scroll animation
    stopScrollAnimation();
    userScrollingRef.current = true;
    if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
    userScrollTimeoutRef.current = setTimeout(() => {
      userScrollingRef.current = false;
    }, 3500);
  };

  useEffect(() => () => stopScrollAnimation(), [stopScrollAnimation]);

  useEffect(() => () => {
    if (lyricsAbortRef.current) lyricsAbortRef.current.abort();
    if (searchAbortRef.current) searchAbortRef.current.abort();
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }, []);

  useEffect(() => {
    if (!isRealtimeSync) return;
    if (userScrollingRef.current) return;
    if (currentActiveLyricIndex >= 0 && lineRefs.current[currentActiveLyricIndex] && lyricsScrollRef.current) {
      const container = lyricsScrollRef.current;
      const activeEl = lineRefs.current[currentActiveLyricIndex];
      const targetTop = activeEl.offsetTop - (container.clientHeight / 2) + (activeEl.clientHeight / 2);
      animateScrollTo(targetTop);
    }
  }, [isRealtimeSync, currentActiveLyricIndex, animateScrollTo]);

  // ── Keyboard shortcut: Escape exits search or lyrics ────────────────────────────
  const closeManualSearch = useCallback(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }
    searchRequestRef.current += 1;
    setIsManualSearchOpen(false);
    setSearchResults(null);
    setSearchSuggestions([]);
    setSearchError('');
    setIsSearching(false);
  }, []);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key !== 'Escape') return;

      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }

      if (isManualSearchOpen) {
        closeManualSearch();
      } else if (onCloseLyrics) {
        onCloseLyrics();
      }
    }
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isManualSearchOpen, onCloseLyrics, closeManualSearch]);

  // Click outside search container to close
  useEffect(() => {
    if (!isManualSearchOpen) return;
    function handleClickOutside(e) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        if (!e.target.closest('.lyrics-icon-btn')) {
          closeManualSearch();
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isManualSearchOpen, closeManualSearch]);

  // ── 4. Seek to Lyric Line on Click ──────────────────────────────────────────────
  const handleLyricLineClick = (time) => {
    if (time == null || !Number.isFinite(time)) return;
    if (audioRef?.current) {
      audioRef.current.currentTime = time;
    }
    if (handleSeek) {
      handleSeek(time);
    }
  };

  // ── 5. Manual Search Handlers ───────────────────────────────────────────────────
  // Suggestions are local, so this can run on every keystroke: history and
  // cached result titles plus the track currently playing. No request is sent
  // until the debounce expires.
  const buildSearchSuggestions = useCallback((value) => {
    const suggestions = getSearchSuggestions(value);
    const normalized = normalizeText(limitSearchQueryInput(value));
    if (normalized.length < 2) return suggestions;

    // Prefer the filename-derived label over raw metadata: the whole point of
    // this flow is that ID3 values can name the wrong uploader/cover artist.
    const seeds = [trackSearchQuery, displayTitle].filter(Boolean);
    for (const seed of seeds) {
      const key = normalizeText(seed);
      if (!key || key === normalized || !key.includes(normalized)) continue;
      if (suggestions.some((item) => normalizeText(item.value) === key)) continue;
      suggestions.unshift({
        value: seed,
        label: displayTitle || seed,
        detail: 'Current track',
      });
    }
    return suggestions.slice(0, 6);
  }, [trackSearchQuery, displayTitle]);

  // True when a manual query is about the track that is playing, so its
  // shortlist can be stored as that track's alternates. A search for some other
  // song must not overwrite the current track's list.
  const queryTargetsCurrentTrack = useCallback((query) => {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return false;
    const titleKey = normalizeText(cleanTrackTitle(currentTitle));
    if (titleKey.length >= 2 && normalizedQuery.includes(titleKey)) {
      const artistKey = normalizeText(currentArtist);
      return !artistKey || normalizedQuery.includes(artistKey);
    }
    const labelKey = normalizeText(trackSearchQuery);
    return Boolean(labelKey) && normalizedQuery === labelKey;
  }, [currentTitle, currentArtist, trackSearchQuery]);

  const performSearch = useCallback(async (query) => {
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }
    if (!query || !query.trim()) {
      searchRequestRef.current += 1;
      setSearchResults(null);
      setSearchError('');
      setIsSearching(false);
      return;
    }
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    const controller = new AbortController();
    searchAbortRef.current = controller;
    let timedOut = false;
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
        const timeoutError = new Error('Lyrics search timed out');
        timeoutError.name = 'AbortError';
        reject(timeoutError);
      }, LYRICS_SEARCH_TIMEOUT_MS);
    });

    setIsSearching(true);
    setSearchSuggestions([]);
    setSearchError('');
    try {
      const results = await Promise.race([
        searchLyrics(query.trim(), effectiveDur, {
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
      if (searchRequestRef.current !== requestId) return;
      setSearchResults(results);
      // Keep the alternates for the playing track so reopening the search box
      // (or pasting the label in a different order) lists them instantly.
      if (queryTargetsCurrentTrack(query)) {
        saveTrackShortlist(currentTitle, currentArtist, results);
      }
    } catch (err) {
      if (searchRequestRef.current !== requestId) return;
      console.error('Manual search error:', err);
      setSearchResults([]);
      setSearchError(timedOut ? MANUAL_SEARCH_TIMEOUT_MESSAGE : MANUAL_SEARCH_FAILED_MESSAGE);
    } finally {
      window.clearTimeout(timeoutId);
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
      }
      if (searchRequestRef.current === requestId) {
        setIsSearching(false);
      }
    }
  }, [effectiveDur, queryTargetsCurrentTrack, currentTitle, currentArtist]);

  const handleSearchInputChange = (val) => {
    const next = limitSearchQueryInput(val);
    if (next === searchQuery) return;
    searchQueryDirtyRef.current = true;
    setSearchQuery(next);
    setSearchResults(null);
    setSearchError('');
    setSearchSuggestions(buildSearchSuggestions(next));
    setIsSearching(false);
    // Typing invalidates the previous query immediately, so its late response
    // cannot replace the suggestions for the new text.
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }
    searchRequestRef.current += 1;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!next.trim()) {
      setIsSearching(false);
      setSearchSuggestions([]);
      return;
    }
    searchDebounceRef.current = setTimeout(() => {
      performSearch(next);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleManualSearchSubmit = (e) => {
    e.preventDefault();
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const query = limitSearchQueryInput(searchQuery);
    setSearchQuery(query);
    setSearchSuggestions([]);
    performSearch(query);
  };

  const handleSuggestionSelect = (suggestion) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchQueryDirtyRef.current = true;
    setSearchQuery(suggestion.value);
    setSearchSuggestions([]);
    setSearchResults(null);
    performSearch(suggestion.value);
  };

  const handleSelectCandidate = (candidate) => {
    const formatted = formatCandidateResult(candidate);
    if (formatted) {
      // The user found the lyrics themselves. Invalidate and abort any automatic
      // lookup still in flight so it cannot overwrite this choice.
      lyricsRequestRef.current += 1;
      if (lyricsAbortRef.current) {
        lyricsAbortRef.current.abort();
        lyricsAbortRef.current = null;
      }
      const resultData = {
        loading: false,
        synced: Boolean(formatted.synced),
        lines: formatted.lines || [],
        instrumental: Boolean(formatted.instrumental),
        error: formatted.error || null,
        unlinked: false,
        trackName: formatted.trackName,
        artistName: formatted.artistName,
        source: formatted.source || 'lrclib',
      };
      manualSelectionRef.current = {
        title: currentTitle,
        artist: currentArtist,
        data: resultData,
      };
      setLyricsData(resultData);
      // Explicit user selections persist until the server is disconnected.
      saveSelectedLyrics(currentTitle, currentArtist, resultData);
      // Remember the whole shortlist this pick came from, so the user can
      // switch to a sibling result later without searching again.
      if (searchResults?.length) {
        saveTrackShortlist(currentTitle, currentArtist, searchResults);
      }
    }
    closeManualSearch();
    lineRefs.current = [];
    setCurrentActiveLyricIndex(-1);
  };

  const toggleManualSearch = () => {
    if (isManualSearchOpen) {
      closeManualSearch();
      return;
    }

    if (!semanticWarmupStartedRef.current) {
      semanticWarmupStartedRef.current = true;
      import('../functions/semanticSearch.js')
        .then(({ warmUpSemanticSearch }) => warmUpSemanticSearch())
        .catch(() => {});
    }
    const initial = searchQueryDirtyRef.current && searchQuery
      ? searchQuery
      : trackSearchQuery || searchQuery || displayTitle || cleanTrackTitle(currentTitle);
    setSearchQuery(initial);
    setSearchSuggestions(buildSearchSuggestions(initial));
    // Automatic lookup already ran the same free-form search, so reuse that
    // shortlist instead of making the window open empty and wait again. The
    // track-keyed shortlist is consulted too: it survives a different query
    // order or a duration that arrived after the automatic lookup.
    const cachedResults = initial ? getCachedSearchResults(initial, effectiveDur) : [];
    const trackResults = getTrackShortlist(currentTitle, currentArtist);
    const instantResults = mergeCandidateLists(trackResults, cachedResults);
    setSearchResults(instantResults.length > 0 ? instantResults : null);
    setIsManualSearchOpen(true);
    if (initial) {
      performSearch(initial);
    }
  };

  const toggleRealtimeSync = useCallback(() => {
    const next = !isRealtimeSync;
    setIsRealtimeSync(next);
    try {
      window.localStorage.setItem(REALTIME_SYNC_KEY, String(next));
    } catch {
      // Storage unavailable
    }

    if (next) {
      // Re-enabling immediately recenters on the line that is playing now.
      userScrollingRef.current = false;
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
        userScrollTimeoutRef.current = null;
      }
    } else {
      stopScrollAnimation();
      setCurrentActiveLyricIndex(-1);
    }
  }, [isRealtimeSync, stopScrollAnimation]);

  const handleUnlinkLyrics = () => {
    if (!currentTitle) return;

    if (isUnlinkingLyrics || lyricsData.loading) {
      lyricsRequestRef.current += 1;
      if (lyricsAbortRef.current) {
        lyricsAbortRef.current.abort();
        lyricsAbortRef.current = null;
      }
      setIsUnlinkingLyrics(false);
      setLyricsData((prev) => ({
        ...prev,
        loading: false,
        synced: false,
        lines: [],
        instrumental: false,
        error: LYRICS_UNLINKED_MESSAGE,
        unlinked: true,
        trackName: cleanTrackTitle(currentTitle) || currentTitle,
        artistName: currentArtist,
      }));
      return;
    }

    const hasLyrics = lyricsData.instrumental || lyricsData.lines?.length > 0;
    manualSelectionRef.current = null;
    unlinkLyricsForTrack(currentTitle, currentArtist);
    closeManualSearch();
    lineRefs.current = [];
    setCurrentActiveLyricIndex(-1);

    if (hasLyrics) {
      lyricsRequestRef.current += 1;
      if (lyricsAbortRef.current) {
        lyricsAbortRef.current.abort();
        lyricsAbortRef.current = null;
      }
      setLyricsData({
        loading: false,
        synced: false,
        lines: [],
        instrumental: false,
        error: LYRICS_UNLINKED_MESSAGE,
        unlinked: true,
        trackName: cleanTrackTitle(currentTitle) || currentTitle,
        artistName: currentArtist,
      });
      return;
    }

    setIsUnlinkingLyrics(true);
    setLyricsData({
      loading: true,
      synced: false,
      lines: [],
      instrumental: false,
      error: null,
      unlinked: true,
      trackName: cleanTrackTitle(currentTitle) || currentTitle,
      artistName: currentArtist,
    });
    loadLyrics(currentTitle, currentArtist, effectiveDur, true, pathLookupLabel).finally(() => {
      setIsUnlinkingLyrics(false);
    });
  };

  // ── 6. Timeline Scrubbing Handlers ──────────────────────────────────────────────
  useEffect(() => {
    let animId;
    let lastSec = -1;
    const updateTimeline = () => {
      const audio = audioRef?.current;
      if (audio && !audio.paused && !audio.seeking && !isScrubbingRef.current) {
        const t = audio.currentTime || 0;
        const dur = effectiveDur || 1;
        const pct = Math.max(0, Math.min((t / dur) * 100, 100));
        if (playedRef.current) playedRef.current.style.width = `${pct}%`;
        if (rangeInputRef.current) rangeInputRef.current.value = Math.min(t, dur);
        const sec = Math.floor(t);
        if (sec !== lastSec) {
          lastSec = sec;
          if (timeTextRef.current && formatTime) {
            timeTextRef.current.textContent = formatTime(t);
          }
        }
      }
      animId = requestAnimationFrame(updateTimeline);
    };
    animId = requestAnimationFrame(updateTimeline);
    return () => cancelAnimationFrame(animId);
  }, [audioRef, effectiveDur, formatTime]);

  const handleSeekInstant = (e) => {
    const val = parseFloat(e.target.value);
    if (Number.isFinite(val) && audioRef?.current) {
      audioRef.current.currentTime = val;
      const pct = Math.max(0, Math.min((val / (effectiveDur || 1)) * 100, 100));
      if (playedRef.current) playedRef.current.style.width = `${pct}%`;
      if (timeTextRef.current && formatTime) timeTextRef.current.textContent = formatTime(val);
    }
  };

  const beginSeek = () => {
    isScrubbingRef.current = true;
  };

  const endSeek = () => {
    isScrubbingRef.current = false;
    if (audioRef?.current && handleSeek) {
      handleSeek(audioRef.current.currentTime);
    }
  };

  // ── 7. Render Shared Sub-sections ──────────────────────────────────────────────
  const renderMatchActionButton = () => (
    <button
      type="button"
      className="lyrics-icon-btn"
      title={isUnlinkingLyrics || lyricsData.loading
        ? 'Stop lyrics search'
        : lyricsData.instrumental || lyricsData.lines?.length > 0
          ? 'Unlink lyrics'
          : 'Find lyrics again'}
      aria-label={isUnlinkingLyrics || lyricsData.loading
        ? 'Stop lyrics search'
        : lyricsData.instrumental || lyricsData.lines?.length > 0
          ? 'Unlink lyrics'
          : 'Find lyrics again'}
      onClick={handleUnlinkLyrics}
      disabled={!currentTitle}
    >
      <MorphIcon
        size={14}
        spring="snappy"
        icon={isUnlinkingLyrics || lyricsData.loading
          ? MorphX
          : lyricsData.instrumental || lyricsData.lines?.length > 0
            ? MorphEyeOff
            : MorphRefresh}
      />
    </button>
  );

  const renderLyricsContent = () => (
    <div
      ref={lyricsScrollRef}
      className="lyrics-scroll-pane select-text"
      onWheel={handleUserScroll}
      onTouchMove={handleUserScroll}
    >
      {lyricsData.loading ? (
        <div className="lyrics-center-message lyrics-center-message--loading select-none" role="status">
          <ClipLoader
            className="lyrics-loader"
            color="#36d7b7"
            size={36}
            speedMultiplier={0.9}
            aria-label="Loading lyrics"
          />
          <p className="lyrics-loading-copy">
            Fetching lyrics for <strong>{displayTitle}</strong>…
          </p>
        </div>
      ) : lyricsData.error || lyricsData.lines.length === 0 ? (
        <div className="lyrics-center-message select-none">
          <MicOff size={42} style={{ color: 'rgba(255, 255, 255, 0.35)', marginBottom: '1rem' }} />
          <p style={{ fontSize: '1.15rem', fontWeight: 600, color: '#ffffff', margin: '0 0 0.4rem' }}>
            {lyricsData.instrumental ? 'Instrumental Track' : 'No Lyrics Available'}
          </p>
          <p style={{ fontSize: '0.88rem', color: 'rgba(255, 255, 255, 0.6)', margin: '0 0 1.25rem', lineHeight: 1.45 }}>
            {lyricsData.instrumental
              ? 'This track does not have vocal lyrics.'
              : lyricsData.error || `We couldn't find time-synced lyrics for "${displayTitle}".`}
          </p>
          {!lyricsData.instrumental && (
            <button
              type="button"
              className="lyrics-pill-btn"
              onClick={toggleManualSearch}
              style={{ padding: '0.55rem 1.1rem', fontSize: '0.85rem' }}
            >
              <Search size={14} /> Search lyrics manually
            </button>
          )}
        </div>
      ) : (
        lyricsData.lines.map((line, idx) => {
          const isActive = idx === currentActiveLyricIndex;
          const isPast = currentActiveLyricIndex >= 0 && idx < currentActiveLyricIndex;
          const isBlank = !line.text || line.text.trim() === '';

          return (
            <div
              key={idx}
              ref={(el) => {
                lineRefs.current[idx] = el;
              }}
              className={`lyric-item${isActive ? ' is-active' : ''}${isPast ? ' is-past' : ''}`}
              role={line.time != null ? 'button' : undefined}
              tabIndex={line.time != null ? 0 : undefined}
              onClick={() => handleLyricLineClick(line.time)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleLyricLineClick(line.time);
                }
              }}
            >
              {isBlank ? (
                <span className="lyrics-dots-break select-none">
                  <span>•</span><span>•</span><span>•</span>
                </span>
              ) : (
                line.text
              )}
            </div>
          );
        })
      )}

      {lyricsData.lines.length > 0 && !lyricsData.loading && (
        (() => {
          // Credit the provider the lyrics were actually fetched from, and
          // link there — not a hardcoded lrclib URL that lies whenever the
          // fallback providers won.
          const source = lyricsData.source || 'lrclib';
          const sourceUrl = source === 'youtube-music'
            ? `https://music.youtube.com/search?q=${encodeURIComponent(
              [lyricsData.trackName, lyricsData.artistName].filter(Boolean).join(' '),
            )}`
            : (LYRICS_SOURCE_URLS[source] || LYRICS_SOURCE_URLS.lrclib);
          const sourceLabel = formatLyricsSource(source) || 'lrclib';
          return (
            <div className="lyrics-attribution select-none">
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={`Lyrics from ${sourceLabel} — open the provider`}
              >
                Lyrics by {sourceLabel}
              </a>
            </div>
          );
        })()
      )}
    </div>
  );

  const renderBottomControllers = () => (
    <div className="lyrics-bottom-bar select-none">
      {/* Timeline seekbar */}
      <div className="player-timeline select-none" aria-label="Playback timeline">
        <span ref={timeTextRef} className="player-time select-none">
          {formatTime ? formatTime(effectiveTime) : '0:00'}
        </span>
        <div className={`player-seekbar-wrap select-none${isPlaying ? ' is-playing' : ''}`}>
          <div className="seekbar-custom-track select-none" />
          <div
            className="seekbar-custom-buffered select-none"
            style={{
              width: `${Math.max(0, Math.min((bufferedTime / (effectiveDur || 1)) * 100, 100))}%`,
            }}
          />
          <div
            ref={playedRef}
            className="seekbar-custom-played select-none"
            style={{
              width: `${Math.max(0, Math.min((effectiveTime / (effectiveDur || 1)) * 100, 100))}%`,
            }}
          />
          <input
            ref={rangeInputRef}
            type="range"
            className="select-none"
            min="0"
            max={effectiveDur}
            value={Math.min(effectiveTime, effectiveDur)}
            step="any"
            onChange={handleSeekInstant}
            onInput={handleSeekInstant}
            onPointerDown={beginSeek}
            onPointerUp={endSeek}
            onPointerCancel={endSeek}
            onTouchStart={beginSeek}
            onTouchEnd={endSeek}
            onTouchCancel={endSeek}
          />
        </div>
        <span className="player-time select-none">
          {formatTime ? formatTime(effectiveDur) : '0:00'}
        </span>
      </div>

      {/* Media control buttons */}
      <div className="player-controls select-none" aria-label="Playback controls">
        <button
          id="repeat-toggle"
          type="button"
          className={`icon-button select-none ${isRepeat ? 'toggle-active' : ''}`}
          aria-label="Toggle repeat"
          onClick={() => {
            const next = !isRepeat;
            setIsRepeat?.(next);
          }}
        >
          <Repeat style={{ width: 'var(--media-icon-size)', height: 'var(--media-icon-size)' }} />
        </button>
        <AnimatedMediaButton
          direction="left"
          id="prev-track"
          type="button"
          className="select-none"
          aria-label="Previous track"
          onClick={playPreviousTrack}
        >
          <SkipBack style={{ width: 'var(--media-icon-size)', height: 'var(--media-icon-size)' }} />
        </AnimatedMediaButton>
        <AnimatedMediaButton
          direction="left"
          id="rewind-10"
          type="button"
          className="select-none"
          aria-label="Rewind 10 seconds"
          onClick={() => skipRelative?.(-10)}
        >
          <Rewind style={{ width: 'var(--media-icon-size)', height: 'var(--media-icon-size)' }} />
        </AnimatedMediaButton>
        <button
          id="play-pause"
          type="button"
          className="icon-button play-main select-none"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={togglePlayPause}
        >
          <MorphIcon
            icon={isPlaying ? MorphPause : MorphPlay}
            size={30}
            style={{ width: 'var(--media-icon-size)', height: 'var(--media-icon-size)' }}
            fill="currentColor"
            stroke="none"
            strokeWidth={0}
            spring="snappy"
          />
        </button>
        <AnimatedMediaButton
          direction="right"
          id="forward-10"
          type="button"
          className="select-none"
          aria-label="Fast forward 10 seconds"
          onClick={() => skipRelative?.(10)}
        >
          <FastForward style={{ width: 'var(--media-icon-size)', height: 'var(--media-icon-size)' }} />
        </AnimatedMediaButton>
        <AnimatedMediaButton
          direction="right"
          id="next-track"
          type="button"
          className="select-none"
          aria-label="Next track"
          onClick={playNextTrack}
        >
          <SkipForward style={{ width: 'var(--media-icon-size)', height: 'var(--media-icon-size)' }} />
        </AnimatedMediaButton>
        <button
          id="shuffle-toggle"
          type="button"
          className={`icon-button select-none ${isShuffle ? 'toggle-active' : ''}`}
          aria-label="Toggle shuffle"
          onClick={() => {
            const next = !isShuffle;
            setIsShuffle?.(next);
          }}
        >
          <Shuffle style={{ width: 'var(--media-icon-size)', height: 'var(--media-icon-size)' }} />
        </button>
      </div>
    </div>
  );

  // Mouse wheel over the album art mirrors the corner zoom button: scrolling
  // up fills the frame, scrolling down fits it again. Direction-based rather
  // than a toggle, so trackpad inertia or a fast spin settles on a stable
  // state instead of flickering between the two.
  const handleArtWheel = (e) => {
    if (!e.deltaY) return;
    const next = e.deltaY < 0;
    setIsArtZoomed((prev) => (prev === next ? prev : next));
  };

  return (
    <div className={`lyrics-view-root select-none${isClosing ? ' is-closing' : ''}`}>
      {/* Blurred album artwork background */}
      <div
        className="lyrics-view-bg select-none"
        style={{ backgroundImage: `url(${artSrc})` }}
      />
      <div className="lyrics-view-overlay select-none" />

      <div className="lyrics-view-container select-none">
        {/* 1. PORTRAIT HEADER: Shrunk album art + Title/Artist + Actions */}
        <div className="lyrics-header-bar select-none">
          <div
            className="lyrics-header-art-thumb select-none"
            role="button"
            tabIndex={0}
            title="Return to album cover"
            onClick={onCloseLyrics}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onCloseLyrics();
            }}
          >
            <img
              className="lyrics-header-art-img select-none"
              src={artSrc}
              alt={displayTitle}
              draggable={false}
              onError={(e) => {
                if (defaultArt && e.currentTarget.src !== defaultArt) {
                  e.currentTarget.src = defaultArt;
                }
              }}
            />
          </div>
          <div className="lyrics-header-meta select-text">
            <span
              className="lyrics-header-title select-text"
              title={onCloseLyrics ? `${displayTitle} • Return to album cover` : displayTitle}
              role={onCloseLyrics ? 'button' : undefined}
              tabIndex={onCloseLyrics ? 0 : undefined}
              onClick={onCloseLyrics}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && onCloseLyrics) {
                  onCloseLyrics();
                }
              }}
            >
              {displayTitle}
            </span>
            {displayArtist && (
              <span className="lyrics-header-artist select-text" title={displayArtist}>
                {displayArtist}
              </span>
            )}
          </div>
          <div className="lyrics-header-actions select-none">
            <button
              type="button"
              className={`lyrics-icon-btn${isManualSearchOpen ? ' is-close-active' : ''}`}
              title="Search lyrics"
              onClick={toggleManualSearch}
            >
              <MorphIcon size={15} spring="snappy" icon={isManualSearchOpen ? MorphX : MorphSearch} />
            </button>
            {renderMatchActionButton()}
            <button
              type="button"
              className={`lyrics-icon-btn lyrics-sync-btn${isRealtimeSync ? ' is-active' : ' is-inactive'}`}
              title={`Real-time lyrics sync ${isRealtimeSync ? 'on' : 'off'} — click to turn ${isRealtimeSync ? 'off' : 'on'}`}
              aria-label={`Real-time lyrics sync ${isRealtimeSync ? 'on' : 'off'}`}
              aria-pressed={isRealtimeSync}
              onClick={toggleRealtimeSync}
            >
              <AudioLines size={15} />
            </button>
          </div>
        </div>

        {/* 2. MIDDLE STAGE: Split (Landscape) or Full (Portrait) */}
        <div className="lyrics-stage-area select-none">
          {/* Landscape Left Column: Info Group (50%) - Album Art + Title/Artist underneath */}
          <div className="lyrics-landscape-art-box select-none">
            <div className="lyrics-landscape-info-wrapper select-none">
              <div
                className="lyrics-landscape-art-frame player-art-frame select-none"
                role="button"
                tabIndex={0}
                aria-label="Show music list (F)"
                title="Show music list (F)"
                onWheel={handleArtWheel}
                onClick={() => {
                  if (onExitToSmallPlayer) {
                    onExitToSmallPlayer();
                  } else if (onCloseLyrics) {
                    onCloseLyrics();
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (onExitToSmallPlayer) {
                      onExitToSmallPlayer();
                    } else if (onCloseLyrics) {
                      onCloseLyrics();
                    }
                  }
                }}
              >
                <div
                  className="player-art-frame-blur select-none"
                  style={{ backgroundImage: `url(${artSrc})` }}
                />
                <img
                  className={`lyrics-landscape-art-img player-art-foreground select-none${isArtZoomed ? ' is-art-zoomed' : ''}`}
                  src={artSrc}
                  alt={displayTitle}
                  draggable={false}
                  style={{
                    objectFit: isArtZoomed ? 'cover' : 'contain',
                  }}
                  onError={(e) => {
                    if (defaultArt && e.currentTarget.src !== defaultArt) {
                      e.currentTarget.src = defaultArt;
                    }
                  }}
                />
                <button
                  type="button"
                  className="player-art-zoom-button select-none"
                  aria-label={isArtZoomed ? 'Show full album art' : 'Fill album art frame'}
                  title={isArtZoomed ? 'Show full album art — scroll to zoom' : 'Fill album art frame — scroll to zoom'}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsArtZoomed((prev) => !prev);
                  }}
                >
                  <MorphIcon
                    size={16}
                    spring="snappy"
                    icon={isArtZoomed ? MorphMinimize2 : MorphMaximize2}
                  />
                </button>
              </div>

              {/* Title & Artist group underneath album art */}
              <div className="lyrics-landscape-meta-row select-none">
                <div className="lyrics-landscape-track-info select-text">
                  <span
                    className="lyrics-landscape-track-title select-text"
                    title={onCloseLyrics ? `${displayTitle} • Return to album cover (L)` : displayTitle}
                    role={onCloseLyrics ? 'button' : undefined}
                    tabIndex={onCloseLyrics ? 0 : undefined}
                    onClick={onCloseLyrics}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && onCloseLyrics) {
                        onCloseLyrics();
                      }
                    }}
                  >
                    {displayTitle}
                  </span>
                  {displayArtist && (
                    <span className="lyrics-landscape-track-artist select-text" title={displayArtist}>
                      {displayArtist}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column (Landscape) or Main Stage (Portrait) */}
          <div className="lyrics-landscape-right-box select-none">
            {/* Top action buttons in landscape */}
            <div className="lyrics-landscape-header select-none">
              <button
                type="button"
                className={`lyrics-icon-btn${isManualSearchOpen ? ' is-close-active' : ''}`}
                title="Search lyrics"
                onClick={toggleManualSearch}
              >
                <MorphIcon size={15} spring="snappy" icon={isManualSearchOpen ? MorphX : MorphSearch} />
              </button>
              {renderMatchActionButton()}
              <button
                type="button"
                className={`lyrics-icon-btn lyrics-sync-btn${isRealtimeSync ? ' is-active' : ' is-inactive'}`}
                title={`Real-time lyrics sync ${isRealtimeSync ? 'on' : 'off'} — click to turn ${isRealtimeSync ? 'off' : 'on'}`}
                aria-label={`Real-time lyrics sync ${isRealtimeSync ? 'on' : 'off'}`}
                aria-pressed={isRealtimeSync}
                onClick={toggleRealtimeSync}
              >
                <AudioLines size={15} />
              </button>
            </div>

            {/* Manual Search Box & Dropdown */}
            {isManualSearchOpen && (
              <div ref={searchContainerRef} className="lyrics-search-box-wrap select-none">
                <form className="lyrics-search-form" onSubmit={handleManualSearchSubmit}>
                  <input
                    type="text"
                    className="lyrics-search-input"
                    placeholder="Search song title or artist..."
                    value={searchQuery}
                    onChange={(e) => handleSearchInputChange(e.target.value)}
                    onFocus={() => {
                      if (!searchResults || searchResults.length === 0) {
                        setSearchSuggestions(buildSearchSuggestions(searchQuery));
                      }
                    }}
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="lyrics-search-icon-btn"
                    title="Search"
                    aria-label="Search"
                    disabled={isSearching}
                  >
                    {isSearching ? (
                      <ClipLoader className="lyrics-search-spinner" color="#36d7b7" size={16} />
                    ) : (
                      <Search size={16} />
                    )}
                  </button>
                </form>

                {/* Lyrics search results */}
                {(isSearching || searchResults !== null || searchSuggestions.length > 0 || currentLyricsMatch) && (
                  <div className="lyrics-search-dropdown select-none">
                    {currentLyricsMatch && (
                      <div className="lyrics-dropdown-current select-none">
                        <div className="lyrics-dropdown-section-label">Currently using</div>
                        <div className="lyrics-dropdown-item lyrics-dropdown-item-current">
                          <div className="lyrics-dropdown-item-main">
                            <span
                              className="lyrics-dropdown-item-title"
                              title={currentLyricsMatch.trackName}
                            >
                              {currentLyricsMatch.trackName}
                            </span>
                            <span
                              className="lyrics-dropdown-item-sub"
                              title={currentLyricsMatch.artistName}
                            >
                              {[
                                currentLyricsMatch.artistName || 'Unknown Artist',
                                formatLyricsSource(currentLyricsMatch.source),
                              ].filter(Boolean).join(' • ')}
                            </span>
                          </div>
                          <div className="lyrics-dropdown-item-meta">
                            {currentLyricsMatch.duration > 0 && (
                              <span className="lyrics-dropdown-dur">
                                {Math.floor(currentLyricsMatch.duration / 60)}:
                                {String(Math.round(currentLyricsMatch.duration % 60)).padStart(2, '0')}
                              </span>
                            )}
                            <span className="lyrics-dropdown-badge lyrics-badge-current">
                              In use
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                    {isSearching && !(searchResults && searchResults.length > 0) ? (
                      <div className="lyrics-dropdown-status select-none">
                        <ClipLoader className="lyrics-search-spinner" color="#36d7b7" size={15} />
                        <span>Searching lyrics…</span>
                      </div>
                    ) : (
                      <>
                        {searchSuggestions.length > 0 && (!searchResults || searchResults.length === 0) && (
                          <div className="lyrics-dropdown-suggestions select-none">
                            <div className="lyrics-dropdown-section-label">Suggestions</div>
                            {searchSuggestions.map((suggestion) => (
                              <button
                                key={suggestion.value}
                                type="button"
                                className="lyrics-suggestion-item select-none"
                                onClick={() => handleSuggestionSelect(suggestion)}
                              >
                                <span className="lyrics-suggestion-icon">
                                  <Search size={12} />
                                </span>
                                <span className="lyrics-suggestion-text">
                                  <span className="lyrics-suggestion-label">{suggestion.label}</span>
                                  {suggestion.detail && (
                                    <span className="lyrics-suggestion-detail">{suggestion.detail}</span>
                                  )}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}

                        {searchResults && searchResults.length === 0 && (
                          <div className="lyrics-dropdown-status select-none">
                            <span>
                              {searchError
                                || (searchSuggestions.length > 0
                                  ? 'No exact match. Try a suggestion:'
                                  : 'No matching lyrics found. Try the song title or another spelling.')}
                            </span>
                          </div>
                        )}

                        {searchResults && searchResults.length > 0 && (
                          <div className="lyrics-dropdown-results select-none">
                            {currentLyricsMatch && (
                              <div className="lyrics-dropdown-section-label">All matches</div>
                            )}
                            {searchResults.map((item) => (
                              <button
                                key={item.id || `${item.name || item.trackName}_${item.artistName || ''}`}
                                type="button"
                                className="lyrics-dropdown-item select-none"
                                onClick={() => handleSelectCandidate(item)}
                              >
                                <div className="lyrics-dropdown-item-main">
                                  <span
                                    className="lyrics-dropdown-item-title"
                                    title={item.name || item.trackName}
                                  >
                                    {item.name || item.trackName}
                                  </span>
                                  <span
                                    className="lyrics-dropdown-item-sub"
                                    title={item.artistName}
                                  >
                                    {item.artistName || 'Unknown Artist'}
                                    {item.albumName ? ` • ${item.albumName}` : ''}
                                  </span>
                                  {item.snippet && (
                                    <span className="lyrics-dropdown-item-snippet">
                                      {item.snippet}
                                    </span>
                                  )}
                                </div>
                                <div className="lyrics-dropdown-item-meta">
                                  {item.duration > 0 && (
                                    <span className="lyrics-dropdown-dur">
                                      {Math.floor(item.duration / 60)}:
                                      {String(Math.round(item.duration % 60)).padStart(2, '0')}
                                    </span>
                                  )}
                                  {item.syncedLyrics ? (
                                    <span className="lyrics-dropdown-badge lyrics-badge-synced">
                                      Synced
                                    </span>
                                  ) : item.instrumental ? (
                                    <span className="lyrics-dropdown-badge lyrics-badge-inst">
                                      Instrumental
                                    </span>
                                  ) : item.plainLyrics ? (
                                    <span className="lyrics-dropdown-badge lyrics-badge-plain">
                                      Plain
                                    </span>
                                  ) : null}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Lyrics Scroll Pane */}
            {renderLyricsContent()}
          </div>
        </div>

        {/* 3. BOTTOM CONTROLLERS: Timeline & Playback Buttons */}
        {renderBottomControllers()}
      </div>
    </div>
  );
}
