import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Shuffle,
  Repeat,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Rewind,
  FastForward,
  X,
} from 'lucide-react';
import { MorphIcon } from 'morphicons/react';
import { Play as MorphPlay, Pause as MorphPause, Maximize2 as MorphMaximize2, Minimize2 as MorphMinimize2 } from 'lucide';
import AnimatedMediaButton from '../components/AnimatedMediaButton.jsx';
import LyricsView from '../components/LyricsView.jsx';
import { dequeueNext } from '../functions/queueService.js';

function isElectronRuntime() {
  return typeof window !== 'undefined' && (
    Boolean(window.electronZoom) ||
    Boolean(window.electron) ||
    Boolean(window.process?.versions?.electron) ||
    /electron/i.test(window.navigator?.userAgent || '')
  );
}

export default function FullscreenMusicPlayer({
  currentlyPlaying,
  currentArtUrl,
  isLargeLayout,
  isPlayerFullscreen,
  setPlayerFullscreen,
  scrollToCurrent,
  currentTime,
  currentDuration,
  bufferedTime = 0,
  handleSeek,
  isRepeat,
  setIsRepeat,
  getPrevIndex,
  handlePlay,
  skipRelative,
  isPlaying,
  togglePlayPause,
  getNextIndex,
  isShuffle,
  setIsShuffle,
  formatTime,
  pickDurationSeconds,
  pickTitle,
  pickArtist,
  defaultArt,
  handleEnded,
  handleTimeUpdate,
  handleLoadedMetadata,
  handleProgress,
  handleAudioPlay,
  handleAudioPause,
  handlePlayForItem,
  audioRef,
}) {
  const artTouchStartRef = useRef(null);
  const artPinchRef = useRef(null);
  const artButtonRef = useRef(null);

  const playedRef = useRef(null);
  const rangeInputRef = useRef(null);
  const timeTextRef = useRef(null);
  const miniTimeTextRef = useRef(null);
  const isScrubbingRef = useRef(false);
  const [isSeekbarActive, setIsSeekbarActive] = useState(false);

  // Timeline requestAnimationFrame update loop
  useEffect(() => {
    let animId;
    let lastSec = -1;
    const updateTimeline = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused && !audio.seeking && !isScrubbingRef.current) {
        const t = audio.currentTime || 0;
        const dur = currentDuration || (currentlyPlaying ? pickDurationSeconds(currentlyPlaying) : 0) || 0;
        if (dur > 0) {
          const pct = Math.max(0, Math.min((t / dur) * 100, 100));
          if (playedRef.current) {
            playedRef.current.style.width = `${pct}%`;
          }
          if (rangeInputRef.current) {
            rangeInputRef.current.value = Math.min(t, dur);
          }
          const sec = Math.floor(t);
          if (sec !== lastSec) {
            lastSec = sec;
            const formatted = formatTime(t);
            if (timeTextRef.current) {
              timeTextRef.current.textContent = formatted;
            }
            if (miniTimeTextRef.current) {
              miniTimeTextRef.current.textContent = formatted;
            }
          }
        }
      }
      animId = requestAnimationFrame(updateTimeline);
    };

    if (isPlaying) {
      animId = requestAnimationFrame(updateTimeline);
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isPlaying, currentDuration, currentlyPlaying, formatTime, audioRef, pickDurationSeconds]);

  // Sync range input value and visualPlayed track when currentTime changes from React state (like seek or song changes)
  useEffect(() => {
    const range = rangeInputRef.current;
    const played = playedRef.current;
    const timeText = timeTextRef.current;
    const audio = audioRef.current;
    
    if (range && !isScrubbingRef.current) {
      const dur = currentDuration || (currentlyPlaying ? pickDurationSeconds(currentlyPlaying) : 0) || 0;
      const actualTime = (audio && Number.isFinite(audio.currentTime)) ? audio.currentTime : currentTime;
      range.value = Math.min(actualTime, dur);
      if (dur > 0) {
        const pct = Math.max(0, Math.min((actualTime / dur) * 100, 100));
        if (played) played.style.width = `${pct}%`;
      } else {
        if (played) played.style.width = '0%';
      }
      const formatted = formatTime(actualTime);
      if (timeText) timeText.textContent = formatted;
      if (miniTimeTextRef.current) miniTimeTextRef.current.textContent = formatted;
    }
  }, [currentTime, currentDuration, currentlyPlaying, formatTime, pickDurationSeconds, audioRef]);

  function handleSeekInstant(e) {
    const val = typeof e === 'number' ? e : (Number(e?.target?.value) || 0);
    const dur = currentDuration || (currentlyPlaying ? pickDurationSeconds(currentlyPlaying) : 0) || 0;
    if (dur > 0) {
      const pct = Math.max(0, Math.min((val / dur) * 100, 100));
      if (playedRef.current) {
        playedRef.current.style.width = `${pct}%`;
      }
      const formatted = formatTime(val);
      if (timeTextRef.current) {
        timeTextRef.current.textContent = formatted;
      }
      if (miniTimeTextRef.current) {
        miniTimeTextRef.current.textContent = formatted;
      }
    }
    if (typeof e === 'number') {
      handleSeek({ target: { value: e } });
    } else {
      handleSeek(e);
    }
  }

  function beginSeekbarInteraction() {
    isScrubbingRef.current = true;
    setIsSeekbarActive(true);
  }

  function endSeekbarInteraction() {
    isScrubbingRef.current = false;
    setIsSeekbarActive(false);
  }

  const [displayArtUrl, setDisplayArtUrl] = useState(currentArtUrl);
  const [isArtZoomed, setIsArtZoomed] = useState(false);

  useEffect(() => {
    setDisplayArtUrl(currentArtUrl);
    setIsArtZoomed(false);
  }, [currentArtUrl]);

  // ── Lyrics View State & Toggle (v2.1.0) ─────────────────────────────────
  const [showLyrics, setShowLyrics] = useState(false);
  const [isClosingLyrics, setIsClosingLyrics] = useState(false);
  const closeLyricsTimerRef = useRef(null);

  const openLyricsSmoothly = useCallback(() => {
    if (closeLyricsTimerRef.current) {
      clearTimeout(closeLyricsTimerRef.current);
      closeLyricsTimerRef.current = null;
    }
    setIsClosingLyrics(false);
    setShowLyrics(true);
  }, []);

  const closeLyricsSmoothly = useCallback(() => {
    if (!showLyrics || isClosingLyrics) return;
    setIsClosingLyrics(true);
    if (closeLyricsTimerRef.current) clearTimeout(closeLyricsTimerRef.current);
    closeLyricsTimerRef.current = setTimeout(() => {
      setShowLyrics(false);
      setIsClosingLyrics(false);
      closeLyricsTimerRef.current = null;
    }, 360);
  }, [showLyrics, isClosingLyrics]);

  useEffect(() => {
    return () => {
      if (closeLyricsTimerRef.current) clearTimeout(closeLyricsTimerRef.current);
    };
  }, []);

  // ── Browser Back Button Navigation: Lyrics -> Fullscreen Player -> Song List ───
  const lyricsHistoryAddedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isElectronRuntime()) return;

    if (isPlayerFullscreen && showLyrics && !lyricsHistoryAddedRef.current) {
      const timer = setTimeout(() => {
        if (!lyricsHistoryAddedRef.current && showLyrics && isPlayerFullscreen) {
          const nextState = { ...(window.history.state || {}), __musicFullscreen: true, __musicLyrics: true };
          window.history.pushState(nextState, '', window.location.pathname);
          lyricsHistoryAddedRef.current = true;
        }
      }, 30);
      return () => clearTimeout(timer);
    }

    if ((!showLyrics || !isPlayerFullscreen) && lyricsHistoryAddedRef.current) {
      lyricsHistoryAddedRef.current = false;
      if (window.history.state?.__musicLyrics) {
        window.history.back();
      }
    }
  }, [showLyrics, isPlayerFullscreen]);

  useEffect(() => {
    if (isElectronRuntime()) return;

    function handleLyricsPopState(e) {
      if (!showLyrics) return;

      const state = e.state || window.history.state;
      if (!state || !state.__musicLyrics) {
        lyricsHistoryAddedRef.current = false;
        closeLyricsSmoothly();
      }
    }

    window.addEventListener('popstate', handleLyricsPopState);
    return () => {
      window.removeEventListener('popstate', handleLyricsPopState);
    };
  }, [showLyrics, closeLyricsSmoothly]);

  const toggleLyrics = useCallback(() => {
    if (!isPlayerFullscreen) {
      setPlayerFullscreen?.(true);
      openLyricsSmoothly();
    } else if (showLyrics && !isClosingLyrics) {
      closeLyricsSmoothly();
    } else {
      openLyricsSmoothly();
    }
  }, [isPlayerFullscreen, setPlayerFullscreen, showLyrics, isClosingLyrics, closeLyricsSmoothly, openLyricsSmoothly]);

  // Keyboard shortcut: 'L' toggles lyrics
  useEffect(() => {
    function handleLyricsKeyDown(e) {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        toggleLyrics();
      }
    }
    window.addEventListener('keydown', handleLyricsKeyDown);
    return () => window.removeEventListener('keydown', handleLyricsKeyDown);
  }, [toggleLyrics]);

  function playPreviousTrack() {
    const idx = getPrevIndex();
    if (idx >= 0) handlePlay(idx, 'prev');
  }

  function playNextTrack() {
    const queued = dequeueNext();
    if (queued && handlePlayForItem) {
      handlePlayForItem(queued, 'next');
      return;
    }
    const idx = getNextIndex();
    if (idx >= 0) handlePlay(idx, 'next');
  }

  // ── Swipe and tap detection via touch events on album art ──────────────────────────
  const ignoreNextClickRef = useRef(false);

  function handleArtTouchStart(event) {
    if (event.touches.length === 2) {
      const firstTouch = event.touches[0];
      const secondTouch = event.touches[1];
      const deltaX = secondTouch.clientX - firstTouch.clientX;
      const deltaY = secondTouch.clientY - firstTouch.clientY;
      artTouchStartRef.current = null;
      artPinchRef.current = {
        distance: Math.hypot(deltaX, deltaY),
        initialZoomed: isArtZoomed,
      };
      return;
    }
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    artTouchStartRef.current = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
  }

  function handleArtTouchMove(event) {
    if (event.touches.length !== 2 || !artPinchRef.current) return;

    const firstTouch = event.touches[0];
    const secondTouch = event.touches[1];
    const deltaX = secondTouch.clientX - firstTouch.clientX;
    const deltaY = secondTouch.clientY - firstTouch.clientY;
    const distanceRatio = Math.hypot(deltaX, deltaY) / artPinchRef.current.distance;

    if (event.cancelable) event.preventDefault();
    if (distanceRatio >= 1.08) {
      setIsArtZoomed(true);
    } else if (distanceRatio <= 0.92) {
      setIsArtZoomed(false);
    } else {
      setIsArtZoomed(artPinchRef.current.initialZoomed);
    }
  }

  // Wheel over the album art mirrors the corner zoom button and the pinch
  // gesture: scroll up fills the frame, scroll down fits it. Gated to the same
  // conditions as the button so it never zooms a hidden or shrunken frame.
  function handleArtWheel(event) {
    if (!(isPlayerFullscreen || isLargeLayout) || showLyrics || isShrunk) return;
    if (!event.deltaY) return;
    const next = event.deltaY < 0;
    setIsArtZoomed((prev) => (prev === next ? prev : next));
  }

  function handleArtTouchEnd(event) {
    if (artPinchRef.current) {
      artPinchRef.current = null;
      artTouchStartRef.current = null;
      return;
    }
    if (!artTouchStartRef.current) return;

    const start = artTouchStartRef.current;
    artTouchStartRef.current = null;

    let touch = null;
    for (let i = 0; i < event.changedTouches.length; i++) {
      if (event.changedTouches[i].identifier === start.id) {
        touch = event.changedTouches[i];
        break;
      }
    }
    if (!touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const duration = Date.now() - start.time;

    // 1. Horizontal swipe gesture in fullscreen -> switch track
    if (isPlayerFullscreen && absX >= 40 && absX > absY * 1.2) {
      if (event.cancelable) event.preventDefault();
      ignoreNextClickRef.current = true;
      if (artButtonRef.current) artButtonRef.current.blur();

      if (deltaX < 0) {
        playNextTrack();
      } else {
        playPreviousTrack();
      }
      return;
    }

    // 2. Tap gesture on touch device -> toggle fullscreen
    if (absX < 15 && absY < 15 && duration < 500) {
      if (event.cancelable) event.preventDefault();
      ignoreNextClickRef.current = true;
      if (setPlayerFullscreen) {
        setPlayerFullscreen((prev) => !prev);
      }
      return;
    }
  }

  function handleArtTouchCancel() {
    artTouchStartRef.current = null;
    artPinchRef.current = null;
  }

  const effectiveAudioTime = (audioRef.current && Number.isFinite(audioRef.current.currentTime)) ? audioRef.current.currentTime : currentTime;
  const effectiveAudioDur = currentDuration || (currentlyPlaying ? pickDurationSeconds(currentlyPlaying) : 0) || 0;

  const isColumnPlayer = Boolean(isLargeLayout && !isPlayerFullscreen);
  const isAdaptiveIcons = Boolean(isColumnPlayer || isPlayerFullscreen);
  const iconStyle = isAdaptiveIcons
    ? { width: 'var(--media-icon-size)', height: 'var(--media-icon-size)' }
    : undefined;
  const normalIconSize = isAdaptiveIcons ? 28 : 18;
  const normalPlayIconSize = isAdaptiveIcons ? 28 : 20;

  const renderArtElement = (isShrunk = false) => {
    if (!currentlyPlaying) return null;
    return (
      <div
        ref={isShrunk ? undefined : artButtonRef}
        className={`player-art select-none${isShrunk ? ' is-shrunk-art' : ''}`}
        role="button"
        tabIndex="0"
        aria-label={isPlayerFullscreen ? (showLyrics ? 'Return to album cover' : 'Show music list (F)') : 'Show fullscreen album art (F)'}
        title={isPlayerFullscreen ? (showLyrics ? 'Return to album cover' : 'Show music list (F)') : 'Show fullscreen album art (F)'}
        style={{ touchAction: 'none' }}
        onTouchStart={isShrunk ? undefined : handleArtTouchStart}
        onTouchMove={isShrunk ? undefined : handleArtTouchMove}
        onTouchEnd={isShrunk ? undefined : handleArtTouchEnd}
        onTouchCancel={isShrunk ? undefined : handleArtTouchCancel}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (showLyrics) {
              setShowLyrics(false);
            } else {
              setPlayerFullscreen?.((prev) => !prev);
            }
          }
        }}
        onClick={(event) => {
          if (ignoreNextClickRef.current) {
            event.preventDefault();
            ignoreNextClickRef.current = false;
            return;
          }
          if (isPlayerFullscreen && showLyrics) {
            setShowLyrics(false);
            return;
          }
          if (setPlayerFullscreen) {
            setPlayerFullscreen((prev) => !prev);
          }
        }}
      >
        <div className="player-art-frame select-none" onWheel={handleArtWheel}>
          <div
            className="player-art-frame-blur select-none"
            style={{ backgroundImage: `url(${displayArtUrl})` }}
          />
          <img
            className={`player-art-foreground select-none${isArtZoomed && !isShrunk ? ' is-art-zoomed' : ''}`}
            src={displayArtUrl}
            alt={pickTitle(currentlyPlaying)}
            draggable={false}
            style={{ objectFit: isArtZoomed && !isShrunk ? 'cover' : undefined, pointerEvents: 'auto', WebkitTouchCallout: 'default', borderRadius: 'inherit' }}
            onError={() => {
              if (displayArtUrl !== defaultArt) {
                setDisplayArtUrl(defaultArt);
              }
            }}
          />
          {(isPlayerFullscreen || isLargeLayout) && !showLyrics && !isShrunk && (
            <button
              type="button"
              className="player-art-zoom-button select-none"
              aria-label={isArtZoomed ? 'Show full album art' : 'Fill album art frame'}
              title={isArtZoomed ? 'Show full album art — scroll to zoom' : 'Fill album art frame — scroll to zoom'}
              onPointerDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => event.stopPropagation()}
              onTouchEnd={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setIsArtZoomed((prev) => !prev);
              }}
            >
              <MorphIcon
                size={16}
                spring="snappy"
                icon={isArtZoomed ? MorphMinimize2 : MorphMaximize2}
              />
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderInfoElement = () => (
    <div className="player-info select-text">
      <div className="player-info-text-group select-text">
        <div id="current-title" className="player-title select-text">
          <button
            type="button"
            className="player-title-button select-text"
            onClick={(e) => {
              if (isPlayerFullscreen) {
                toggleLyrics();
              } else if (scrollToCurrent) {
                scrollToCurrent(e);
              }
            }}
            title={
              isPlayerFullscreen
                ? `${currentlyPlaying ? pickTitle(currentlyPlaying) : ''} • Lyrics (L)`
                : (currentlyPlaying ? pickTitle(currentlyPlaying) : '')
            }
          >
            {currentlyPlaying ? pickTitle(currentlyPlaying) : ''}
          </button>
        </div>
        <div id="current-artist" className="player-artist select-text">
          {currentlyPlaying && pickArtist(currentlyPlaying) ? (
            <>
              <span className="player-artist-name select-text">
                {pickArtist(currentlyPlaying)}
              </span>
              <span className="mini-player-timestamp select-text">
                &nbsp;· <span ref={miniTimeTextRef}>{formatTime(effectiveAudioTime)}</span>
              </span>
            </>
          ) : (
            <span className="mini-player-timestamp select-text">
              <span ref={miniTimeTextRef}>{formatTime(effectiveAudioTime)}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );

  const renderTimelineElement = () => (
    <div className="player-timeline select-none" aria-label="Playback timeline">
      <span ref={timeTextRef} className="player-time select-none">{formatTime(effectiveAudioTime)}</span>
      <div className={`player-seekbar-wrap select-none${isSeekbarActive ? ' is-scrubbing' : ''}${isPlaying ? ' is-playing' : ''}`}>
        <div className="seekbar-custom-track select-none" />
        <div
          className="seekbar-custom-buffered select-none"
          style={{
            width: `${Math.max(
              0,
              Math.min(
                (bufferedTime / (effectiveAudioDur || 1)) * 100,
                100
              )
            )}%`,
          }}
        />
        <div
          ref={playedRef}
          className="seekbar-custom-played select-none"
          style={{
            width: `${Math.max(
              0,
              Math.min(
                (effectiveAudioTime / (effectiveAudioDur || 1)) * 100,
                100
              )
            )}%`,
          }}
        />
        <input
          ref={rangeInputRef}
          type="range"
          className="select-none"
          min="0"
          max={effectiveAudioDur}
          value={Math.min(effectiveAudioTime, effectiveAudioDur)}
          step="any"
          onChange={handleSeekInstant}
          onInput={handleSeekInstant}
          onPointerDown={beginSeekbarInteraction}
          onPointerUp={endSeekbarInteraction}
          onPointerCancel={endSeekbarInteraction}
          onTouchStart={beginSeekbarInteraction}
          onTouchEnd={endSeekbarInteraction}
          onTouchCancel={endSeekbarInteraction}
          onBlur={endSeekbarInteraction}
        />
      </div>
      <span className="player-time select-none">{formatTime(effectiveAudioDur)}</span>
    </div>
  );

  const renderControlsElement = () => (
    <div className="player-controls select-none" aria-label="Playback controls">
      <button
        id="repeat-toggle"
        type="button"
        className={`icon-button select-none ${isRepeat ? 'toggle-active' : ''}`}
        aria-label="Toggle repeat"
        aria-pressed={isRepeat ? 'true' : 'false'}
        onClick={() => {
          const nextState = !isRepeat;
          setIsRepeat(nextState);
        }}
      >
        <Repeat size={normalIconSize} style={iconStyle} />
      </button>
      <AnimatedMediaButton
        direction="left"
        id="prev-track"
        type="button"
        className="select-none"
        aria-label="Previous track"
        onClick={playPreviousTrack}
      >
        <SkipBack size={normalIconSize} style={iconStyle} />
      </AnimatedMediaButton>
      <AnimatedMediaButton
        direction="left"
        id="rewind-10"
        type="button"
        className="select-none"
        aria-label="Rewind 10 seconds"
        onClick={() => skipRelative(-10)}
      >
        <Rewind size={normalIconSize} style={iconStyle} />
      </AnimatedMediaButton>
      <button
        id="play-pause"
        type="button"
        className="icon-button play-main select-none"
        aria-label={isPlaying ? 'Pause' : 'Play'}
        aria-pressed={isPlaying ? 'true' : 'false'}
        onClick={togglePlayPause}
      >
        <MorphIcon
          icon={isPlaying ? MorphPause : MorphPlay}
          size={normalPlayIconSize}
          style={iconStyle}
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
        onClick={() => skipRelative(10)}
      >
        <FastForward size={normalIconSize} style={iconStyle} />
      </AnimatedMediaButton>
      <AnimatedMediaButton
        direction="right"
        id="next-track"
        type="button"
        className="select-none"
        aria-label="Next track"
        onClick={playNextTrack}
      >
        <SkipForward size={normalIconSize} style={iconStyle} />
      </AnimatedMediaButton>
      <button
        id="shuffle-toggle"
        type="button"
        className={`icon-button select-none ${isShuffle ? 'toggle-active' : ''}`}
        aria-label="Toggle shuffle"
        aria-pressed={isShuffle ? 'true' : 'false'}
        onClick={() => {
          const nextState = !isShuffle;
          setIsShuffle(nextState);
        }}
      >
        <Shuffle size={normalIconSize} style={iconStyle} />
      </button>
    </div>
  );

  return (
    <>
      {isPlayerFullscreen && showLyrics && currentlyPlaying && (
        <LyricsView
          currentlyPlaying={currentlyPlaying}
          currentArtUrl={currentArtUrl}
          displayArtUrl={displayArtUrl}
          defaultArt={defaultArt}
          isArtZoomed={isArtZoomed}
          setIsArtZoomed={setIsArtZoomed}
          currentTime={currentTime}
          currentDuration={currentDuration}
          bufferedTime={bufferedTime}
          isPlaying={isPlaying}
          isRepeat={isRepeat}
          setIsRepeat={setIsRepeat}
          isShuffle={isShuffle}
          setIsShuffle={setIsShuffle}
          handleSeek={handleSeekInstant}
          togglePlayPause={togglePlayPause}
          playPreviousTrack={playPreviousTrack}
          playNextTrack={playNextTrack}
          skipRelative={skipRelative}
          formatTime={formatTime}
          isClosing={isClosingLyrics}
          onCloseLyrics={closeLyricsSmoothly}
          onExitToSmallPlayer={() => {
            if (closeLyricsTimerRef.current) {
              clearTimeout(closeLyricsTimerRef.current);
              closeLyricsTimerRef.current = null;
            }
            setIsClosingLyrics(false);
            setShowLyrics(false);
            if (lyricsHistoryAddedRef.current && window.history.state?.__musicLyrics) {
              lyricsHistoryAddedRef.current = false;
              window.history.go(-2);
            } else {
              setPlayerFullscreen?.(false);
            }
          }}
          audioRef={audioRef}
          pickTitle={pickTitle}
          pickArtist={pickArtist}
          pickDurationSeconds={pickDurationSeconds}
        />
      )}

      <footer
        className={`player select-none${isColumnPlayer ? ' column-player' : ''}${
          isPlayerFullscreen && showLyrics
            ? isClosingLyrics
              ? ' lyrics-transition-out'
              : ' lyrics-transition-in'
            : ''
        }`}
        id="player"
        hidden={!currentlyPlaying}
      >
        {currentlyPlaying && (
          <div
            className="player-background select-none"
            style={{ backgroundImage: `url(${currentArtUrl})`, pointerEvents: 'none' }}
          />
        )}
        <div className="player-overlay select-none" style={{ pointerEvents: 'none' }} />
        <div className="player-content select-none">
          <div className="player-main select-none">
            {renderArtElement(false)}
            {renderInfoElement()}
          </div>
          {renderTimelineElement()}
          {renderControlsElement()}
        </div>
      </footer>
      <audio
        id="audio"
        ref={audioRef}
        preload="none"
        loop={isRepeat}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onProgress={handleProgress}
        onPlay={handleAudioPlay}
        onPause={handleAudioPause}
        style={{ display: 'none' }}
      />
    </>
  );
}
