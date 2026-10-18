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
  RefreshCw,
  X,
  Disc,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { MorphIcon } from 'morphicons/react';
import { Play as MorphPlay, Pause as MorphPause } from 'lucide';
import { ClipLoader } from 'react-spinners';
import AnimatedMediaButton from './AnimatedMediaButton.jsx';
import {
  fetchLyrics,
  cleanTrackTitle,
  parseTrackAndArtist,
  searchLyrics,
  formatCandidateResult,
  saveSessionLyrics,
  getSessionLyrics,
  saveSelectedLyrics,
  getSelectedLyrics,
} from '../functions/lyricsService.js';
import './LyricsView.css';

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
    trackName: '',
    artistName: '',
  });

  const [currentActiveLyricIndex, setCurrentActiveLyricIndex] = useState(-1);
  const [isManualSearchOpen, setIsManualSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const searchDebounceRef = useRef(null);
  const searchContainerRef = useRef(null);
  const lyricsRequestRef = useRef(0);

  const lyricsScrollRef = useRef(null);
  const lineRefs = useRef([]);
  const userScrollingRef = useRef(false);
  const userScrollTimeoutRef = useRef(null);

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
  const displayTitle = cleanTrackTitle(lyricsData.trackName) || parsedCurrent.title || cleanTrackTitle(currentTitle);
  const displayArtist = lyricsData.artistName || parsedCurrent.artist || currentArtist;
  const artSrc = displayArtUrl || currentArtUrl || defaultArt;

  // ── 1. Fetch Lyrics on track change ──────────────────────────────────────────────
  const loadLyrics = useCallback(async (title, artist, duration, forceRefresh = false) => {
    if (!title) return;
    const requestId = lyricsRequestRef.current + 1;
    lyricsRequestRef.current = requestId;
    const isCurrentRequest = () => lyricsRequestRef.current === requestId;

    if (!forceRefresh) {
      const selectedLyrics = getSelectedLyrics(title, artist);
      if (selectedLyrics && (selectedLyrics.lines?.length > 0 || selectedLyrics.instrumental)) {
        if (!isCurrentRequest()) return;
        setLyricsData({
          loading: false,
          synced: Boolean(selectedLyrics.synced),
          lines: selectedLyrics.lines || [],
          instrumental: Boolean(selectedLyrics.instrumental),
          error: selectedLyrics.error || null,
          trackName: cleanTrackTitle(selectedLyrics.trackName) || selectedLyrics.trackName || title,
          artistName: selectedLyrics.artistName || artist,
        });
        return;
      }

      const sessionCached = getSessionLyrics(title, artist);
      if (sessionCached && (sessionCached.lines?.length > 0 || sessionCached.instrumental)) {
        if (!isCurrentRequest()) return;
        setLyricsData({
          loading: false,
          synced: Boolean(sessionCached.synced),
          lines: sessionCached.lines || [],
          instrumental: Boolean(sessionCached.instrumental),
          error: sessionCached.error || null,
          trackName: cleanTrackTitle(sessionCached.trackName) || sessionCached.trackName || title,
          artistName: sessionCached.artistName || artist,
        });
        return;
      }
    }

    setLyricsData((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetchLyrics(title, artist, duration, forceRefresh);
      if (!isCurrentRequest()) return;
      if (res) {
        const cleanName = cleanTrackTitle(res.trackName) || res.trackName || title;
        const resultData = {
          loading: false,
          synced: Boolean(res.synced),
          lines: res.lines || [],
          instrumental: Boolean(res.instrumental),
          error: res.error || null,
          trackName: cleanName,
          artistName: res.artistName || artist,
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
        error: 'Failed to fetch lyrics. Check network connection.',
        trackName: title,
        artistName: artist,
      });
    }
  }, []);

  useEffect(() => {
    if (!currentlyPlaying) return;
    const parsed = parseTrackAndArtist(currentTitle, currentArtist);
    const mediaTitle = cleanTrackTitle(currentTitle) || parsed.title;
    const mediaArtist = currentArtist || parsed.artist;
    lyricsRequestRef.current += 1;
    setLyricsData({
      loading: true,
      synced: false,
      lines: [],
      instrumental: false,
      error: null,
      trackName: mediaTitle,
      artistName: mediaArtist,
    });
    setSearchQuery([currentTitle, currentArtist].filter(Boolean).join(' ') || parsed.title || cleanTrackTitle(currentTitle));
    setIsManualSearchOpen(false);
    setSearchResults(null);
    lineRefs.current = [];
    setCurrentActiveLyricIndex(-1);
    loadLyrics(currentTitle, currentArtist, effectiveDur);
  }, [currentlyPlaying, currentTitle, currentArtist, effectiveDur, loadLyrics]);

  // ── 2. Time-Sync Detection Loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (!lyricsData.lines || lyricsData.lines.length === 0) return;

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
  }, [lyricsData.lines, currentActiveLyricIndex, audioRef, currentTime]);

  // ── 3. Smooth Auto-Scroll with User Interaction Detection ───────────────────────
  const handleUserScroll = () => {
    userScrollingRef.current = true;
    if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
    userScrollTimeoutRef.current = setTimeout(() => {
      userScrollingRef.current = false;
    }, 3500);
  };

  useEffect(() => {
    if (userScrollingRef.current) return;
    if (currentActiveLyricIndex >= 0 && lineRefs.current[currentActiveLyricIndex] && lyricsScrollRef.current) {
      const container = lyricsScrollRef.current;
      const activeEl = lineRefs.current[currentActiveLyricIndex];
      const targetTop = activeEl.offsetTop - (container.clientHeight / 2) + (activeEl.clientHeight / 2);
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      });
    }
  }, [currentActiveLyricIndex]);

  // ── Keyboard shortcut: Escape exits search or lyrics ────────────────────────────
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key !== 'Escape') return;

      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }

      if (isManualSearchOpen) {
        setIsManualSearchOpen(false);
        setSearchResults(null);
      } else if (onCloseLyrics) {
        onCloseLyrics();
      }
    }
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isManualSearchOpen, onCloseLyrics]);

  // Click outside search container to close
  useEffect(() => {
    if (!isManualSearchOpen) return;
    function handleClickOutside(e) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        if (!e.target.closest('.lyrics-icon-btn')) {
          setIsManualSearchOpen(false);
          setSearchResults(null);
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isManualSearchOpen]);

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
  const performSearch = useCallback(async (query) => {
    if (!query || !query.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    try {
      const results = await searchLyrics(query.trim(), effectiveDur);
      setSearchResults(results);
    } catch (err) {
      console.error('Manual search error:', err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [effectiveDur]);

  const handleSearchInputChange = (val) => {
    setSearchQuery(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!val.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }
    searchDebounceRef.current = setTimeout(() => {
      performSearch(val);
    }, 400);
  };

  const handleManualSearchSubmit = (e) => {
    e.preventDefault();
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    performSearch(searchQuery);
  };

  const [isRefreshingAnim, setIsRefreshingAnim] = useState(false);

  const handleSelectCandidate = (candidate) => {
    const formatted = formatCandidateResult(candidate);
    if (formatted) {
      const resultData = {
        loading: false,
        synced: Boolean(formatted.synced),
        lines: formatted.lines || [],
        instrumental: Boolean(formatted.instrumental),
        error: formatted.error || null,
        trackName: formatted.trackName,
        artistName: formatted.artistName,
      };
      setLyricsData(resultData);
      // Explicit user selections persist until the server is disconnected.
      saveSelectedLyrics(currentTitle, currentArtist, resultData);
    }
    setIsManualSearchOpen(false);
    setSearchResults(null);
    lineRefs.current = [];
    setCurrentActiveLyricIndex(-1);
  };

  const toggleManualSearch = () => {
    setIsManualSearchOpen((prev) => {
      const next = !prev;
      if (next) {
        const initial = searchQuery || [currentTitle, currentArtist].filter(Boolean).join(' ') || displayTitle || cleanTrackTitle(currentTitle);
        setSearchQuery(initial);
        if (initial) {
          performSearch(initial);
        }
      } else {
        setSearchResults(null);
      }
      return next;
    });
  };

  const handleRefreshLyrics = () => {
    setIsRefreshingAnim(true);
    setTimeout(() => setIsRefreshingAnim(false), 650);

    // Center ongoing lyrics without changing the song
    userScrollingRef.current = false;
    if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);

    if (currentActiveLyricIndex >= 0 && lineRefs.current[currentActiveLyricIndex] && lyricsScrollRef.current) {
      const container = lyricsScrollRef.current;
      const activeEl = lineRefs.current[currentActiveLyricIndex];
      const targetTop = activeEl.offsetTop - (container.clientHeight / 2) + (activeEl.clientHeight / 2);
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      });
    } else if (lyricsData.error || lyricsData.lines.length === 0) {
      // If error or empty, re-fetch without changing song
      loadLyrics(currentTitle, currentArtist, effectiveDur, true);
    }
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
  const renderLyricsContent = () => (
    <div
      ref={lyricsScrollRef}
      className="lyrics-scroll-pane select-text"
      onScroll={handleUserScroll}
      onTouchMove={handleUserScroll}
      onWheel={handleUserScroll}
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
              : `We couldn't find time-synced lyrics for "${displayTitle}".`}
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
        <div className="lyrics-attribution select-none">
          <a
            href="https://lrclib.net"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            Lyrics by lrc.red
          </a>
        </div>
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
        <div className="player-seekbar-wrap select-none is-playing">
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
              className="lyrics-icon-btn"
              title="Search lyrics"
              onClick={toggleManualSearch}
            >
              <Search size={15} />
            </button>
            <button
              type="button"
              className="lyrics-icon-btn"
              title="Center ongoing lyrics / Refresh"
              onClick={handleRefreshLyrics}
            >
              <RefreshCw size={13} className={isRefreshingAnim || lyricsData.loading ? 'animate-spin' : ''} />
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
                  title={isArtZoomed ? 'Show full album art' : 'Fill album art frame'}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsArtZoomed((prev) => !prev);
                  }}
                >
                  {isArtZoomed ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
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
                className="lyrics-icon-btn"
              title="Search lyrics"
                onClick={toggleManualSearch}
              >
                <Search size={15} />
              </button>
              <button
                type="button"
                className="lyrics-icon-btn"
                title="Center ongoing lyrics / Refresh"
                onClick={handleRefreshLyrics}
              >
                <RefreshCw size={13} className={isRefreshingAnim || lyricsData.loading ? 'animate-spin' : ''} />
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
                  <button
                    type="button"
                    className="lyrics-search-close-btn"
                    title="Close search"
                    aria-label="Close search"
                    onClick={() => {
                      setIsManualSearchOpen(false);
                      setSearchResults(null);
                    }}
                  >
                    <X size={16} />
                  </button>
                </form>

                {/* Lyrics search results */}
                {(isSearching || searchResults !== null) && (
                  <div className="lyrics-search-dropdown select-none">
                    {isSearching ? (
                      <div className="lyrics-dropdown-status select-none">
                        <ClipLoader className="lyrics-search-spinner" color="#36d7b7" size={15} />
                        <span>Searching lyrics…</span>
                      </div>
                    ) : searchResults && searchResults.length === 0 ? (
                      <div className="lyrics-dropdown-status select-none">
                        <span>No matching lyrics found. Try the song title or another spelling.</span>
                      </div>
                    ) : searchResults && (
                      <div className="lyrics-dropdown-results select-none">
                        {searchResults.map((item) => (
                          <button
                            key={item.id}
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
