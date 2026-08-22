import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import {
  AppWindow,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FastForward,
  Gauge,
  Maximize,
  Minimize,
  MoreVertical,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Rewind,
  RotateCw,
  Scaling,
  SkipBack,
  SkipForward,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
} from '../components/ui/dropdown-menu.jsx';
import { dequeueNext, showToast } from '../functions/queueService.js';

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];


export default function FullscreenVideoPlayer({
  reloadNonce,
  selectedVideo,
  pickTitle,
  pickFolderName,
  isMobileViewport,
  isEdgeAndroidBrowser,
  isFullscreen,
  isWindowFullscreen,
  isVideoFullscreenView,
  onMinimizeToggle,
  isVideoMinimized,
  isPortraitVideo,
  controlsVisible,
  setControlsVisible,
  clearHideTimer,
  resetHideTimer,
  videoAspectRatio,
  videoContainerRef,
  handleContainerMouseMove,
  handleVideoScreenTouchStart,
  handleVideoScreenTouchEnd,
  videoRef,
  selectedVideoSource,
  selectedVideoPoster,
  isLooping,
  handleTimeUpdate,
  handleLoadedMetadata,
  handleDurationChange,
  handleProgress,
  bufferedTime = 0,
  handleVideoPlay,
  handleVideoPause,
  handleVideoEnded,
  keyboardActionHint,
  actionIcons,
  MarqueeTextComponent,
  scrollToCurrent,
  currentTime,
  scrubPreviewTime,
  isScrubbingTimeline,
  currentDuration,
  seekPreviewLeft,
  isSeekPreviewVisible,
  seekPreviewVideoRef,
  handleSeekChange,
  handleSeekPreview,
  beginTimelineScrub,
  endTimelineScrub,
  handleSeekHover,
  handleSeekMouseLeave,
  hideSeekPreviewSoon,
  isTouchInput,
  formatTime,
  isFloatingWindow,
  toggleLooping,
  toggleFloatingWindow,
  supportsFloatingWindow,
  skipVideoRelative,
  goToPreviousVideo,
  goToNextVideo,
  isPlaying,
  togglePlayPause,
  isWinOrLinux,
  handleManualRotate,
  canUseWindowFullscreen,
  toggleWindowFullscreen,
  toggleFullscreen,
  isTrueMobileDevice,
  spriteSheet,
}) {
  const MarqueeText = MarqueeTextComponent;
  const canMinimize = isTrueMobileDevice;
  const effectiveIsVideoMinimized = isVideoMinimized && canMinimize && !isVideoFullscreenView;
  const shouldShowAmbient = !!selectedVideo;
  const shouldUseNormalAmbientLayout =
    isPortraitVideo || (Number.isFinite(videoAspectRatio) && videoAspectRatio < 1);

  const playedRef = useRef(null);
  const rangeInputRef = useRef(null);
  const timeTextRef = useRef(null);

  const [playbackRate, setPlaybackRate] = useState(1);
  const [videoScaleMode, setVideoScaleMode] = useState('contain');
  const [menuView, setMenuView] = useState('main');
  const [isEdgeToastActive, setIsEdgeToastActive] = useState(false);
  const edgeToastTimerRef = useRef(null);
  const prevIsVideoFullscreenViewRef = useRef(false);

  useEffect(() => {
    const isEnteringFullscreen = !prevIsVideoFullscreenViewRef.current && isVideoFullscreenView;
    prevIsVideoFullscreenViewRef.current = isVideoFullscreenView;

    if (isEdgeAndroidBrowser && isEnteringFullscreen) {
      setIsEdgeToastActive(true);
      if (edgeToastTimerRef.current) {
        clearTimeout(edgeToastTimerRef.current);
      }
      edgeToastTimerRef.current = setTimeout(() => {
        setIsEdgeToastActive(false);
      }, 4250);
    } else if (!isVideoFullscreenView) {
      setIsEdgeToastActive(false);
      if (edgeToastTimerRef.current) {
        clearTimeout(edgeToastTimerRef.current);
        edgeToastTimerRef.current = null;
      }
    }

    return () => {
      if (edgeToastTimerRef.current) {
        clearTimeout(edgeToastTimerRef.current);
        edgeToastTimerRef.current = null;
      }
    };
  }, [isEdgeAndroidBrowser, isVideoFullscreenView]);

  const [isPinchZoomEnabled, setIsPinchZoomEnabled] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });

  const touchStartDistRef = useRef(null);
  const touchStartScaleRef = useRef(1);
  const touchStartCenterRef = useRef(null);
  const touchStartPanRef = useRef({ x: 0, y: 0 });

  const clampPan = useCallback((panX, panY, scale) => {
    if (scale <= 1) return { x: 0, y: 0 };
    const container = videoContainerRef.current;
    const rect = container ? container.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
    const maxPanX = Math.max(0, ((scale - 1) * rect.width) / 2);
    const maxPanY = Math.max(0, ((scale - 1) * rect.height) / 2);

    return {
      x: Math.min(Math.max(panX, -maxPanX), maxPanX),
      y: Math.min(Math.max(panY, -maxPanY), maxPanY),
    };
  }, [videoContainerRef]);

  useEffect(() => {
    if (!isPinchZoomEnabled || !isVideoFullscreenView) {
      setIsPinchZoomEnabled(false);
      setZoomScale(1);
      setPanPosition({ x: 0, y: 0 });
    }
  }, [isPinchZoomEnabled, selectedVideoSource, isVideoFullscreenView]);

  useEffect(() => {
    if (reloadNonce > 0) {
      setPlaybackRate(1);
      setVideoScaleMode('contain');
      if (videoRef.current) {
        videoRef.current.playbackRate = 1;
        videoRef.current.style.setProperty('object-fit', 'contain', 'important');
      }
    }
  }, [reloadNonce, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (zoomScale > 1 || panPosition.x !== 0 || panPosition.y !== 0) {
      video.style.transform = `translate3d(${panPosition.x}px, ${panPosition.y}px, 0px) scale(${zoomScale})`;
      video.style.transformOrigin = 'center center';
    } else {
      video.style.transform = 'none';
    }
  }, [zoomScale, panPosition, videoRef]);

  const [isMouseDragging, setIsMouseDragging] = useState(false);
  const mouseDragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const handleMouseDown = (e) => {
    if (!isPinchZoomEnabled || zoomScale <= 1) return;
    if (e.button !== 0) return;
    setIsMouseDragging(true);
    mouseDragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: panPosition.x,
      panY: panPosition.y,
    };
  };

  const handleMouseMove = (e) => {
    if (!isMouseDragging || !isPinchZoomEnabled || zoomScale <= 1) return;
    const deltaX = e.clientX - mouseDragStartRef.current.x;
    const deltaY = e.clientY - mouseDragStartRef.current.y;
    const rawPanX = mouseDragStartRef.current.panX + deltaX;
    const rawPanY = mouseDragStartRef.current.panY + deltaY;
    const clamped = clampPan(rawPanX, rawPanY, zoomScale);
    setPanPosition(clamped);
  };

  const handleMouseUp = () => {
    if (isMouseDragging) {
      setIsMouseDragging(false);
    }
  };

  const handleWheel = (e) => {
    if (!isPinchZoomEnabled || !isVideoFullscreenView) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.25 : -0.25;
    const newScale = Math.min(Math.max(1, zoomScale + delta), 4.5);
    setZoomScale(newScale);
    if (newScale === 1) {
      setPanPosition({ x: 0, y: 0 });
    } else {
      setPanPosition((prev) => clampPan(prev.x, prev.y, newScale));
    }
  };

  const handleDoubleClick = (e) => {
    if (!isPinchZoomEnabled || !isVideoFullscreenView) return;
    e.stopPropagation();
    if (zoomScale > 1) {
      setZoomScale(1);
      setPanPosition({ x: 0, y: 0 });
    } else {
      setZoomScale(2.5);
      setPanPosition({ x: 0, y: 0 });
    }
  };

  const handleTouchStart = (e) => {
    if (e.target && e.target.closest && e.target.closest('.video-zoom-floating-bar')) {
      return;
    }
    if (!isPinchZoomEnabled) {
      if (handleVideoScreenTouchStart) handleVideoScreenTouchStart(e);
      return;
    }

    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDistRef.current = dist;
      touchStartScaleRef.current = zoomScale;
      touchStartCenterRef.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
      touchStartPanRef.current = panPosition;
    } else if (e.touches.length === 1 && zoomScale > 1) {
      touchStartCenterRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
      touchStartPanRef.current = panPosition;
    }

    if (handleVideoScreenTouchStart) handleVideoScreenTouchStart(e);
  };

  const handleTouchMove = (e) => {
    if (e.target && e.target.closest && e.target.closest('.video-zoom-floating-bar')) {
      return;
    }
    if (!isPinchZoomEnabled) return;

    if (e.touches.length === 2 && touchStartDistRef.current) {
      e.preventDefault();
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scaleRatio = currentDist / touchStartDistRef.current;
      const rawScale = touchStartScaleRef.current * scaleRatio;
      const newScale = Math.min(Math.max(1, rawScale), 4.5);

      const container = videoContainerRef.current;
      const rect = container ? container.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
      const currentCenter = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - (rect.left + rect.width / 2),
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - (rect.top + rect.height / 2),
      };

      const startCenter = touchStartCenterRef.current
        ? {
            x: touchStartCenterRef.current.x - (rect.left + rect.width / 2),
            y: touchStartCenterRef.current.y - (rect.top + rect.height / 2),
          }
        : { x: 0, y: 0 };

      const deltaCenterX = currentCenter.x - startCenter.x;
      const deltaCenterY = currentCenter.y - startCenter.y;

      const rawPanX = touchStartPanRef.current.x * (newScale / Math.max(1, touchStartScaleRef.current)) + deltaCenterX;
      const rawPanY = touchStartPanRef.current.y * (newScale / Math.max(1, touchStartScaleRef.current)) + deltaCenterY;

      const clamped = clampPan(rawPanX, rawPanY, newScale);
      setZoomScale(newScale);
      setPanPosition(clamped);
    } else if (e.touches.length === 1 && zoomScale > 1 && touchStartCenterRef.current) {
      e.preventDefault();
      const deltaX = e.touches[0].clientX - touchStartCenterRef.current.x;
      const deltaY = e.touches[0].clientY - touchStartCenterRef.current.y;
      const rawPanX = touchStartPanRef.current.x + deltaX;
      const rawPanY = touchStartPanRef.current.y + deltaY;
      const clamped = clampPan(rawPanX, rawPanY, zoomScale);
      setPanPosition(clamped);
    }
  };

  const handleTouchEnd = (e) => {
    if (e.target && e.target.closest && e.target.closest('.video-zoom-floating-bar')) {
      return;
    }
    if (isPinchZoomEnabled) {
      if (e.touches.length < 2) {
        touchStartDistRef.current = null;
      }
      if (e.touches.length === 0) {
        touchStartCenterRef.current = null;
        if (zoomScale <= 1.05) {
          setZoomScale(1);
          setPanPosition({ x: 0, y: 0 });
        } else {
          setPanPosition((prev) => clampPan(prev.x, prev.y, zoomScale));
        }
      }
    }
    if (handleVideoScreenTouchEnd) handleVideoScreenTouchEnd(e);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = playbackRate;
      video.style.setProperty('object-fit', videoScaleMode, 'important');
    }
  }, [playbackRate, videoScaleMode, selectedVideoSource, videoRef, isFullscreen, isWindowFullscreen, effectiveIsVideoMinimized]);

  const handleRateChange = (speed) => {
    setPlaybackRate(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    showToast({
      action: 'speed',
      message: `Speed: ${speed}x`,
    });
  };

  const handleScaleChange = (mode) => {
    setVideoScaleMode(mode);
    const label = mode === 'contain' ? 'Fit' : mode === 'fill' ? 'Stretch' : 'Crop';
    showToast({
      action: 'scaling',
      message: `Scaling: ${label}`,
    });
  };


  const lastTimelineUpdateRef = useRef(0);
  useEffect(() => {
    let animId;
    const updateTimeline = () => {
      const now = performance.now();
      if (now - lastTimelineUpdateRef.current >= 33) { // Throttle timeline DOM updates to ~30 FPS
        lastTimelineUpdateRef.current = now;
        const video = videoRef.current;
        if (video && !video.paused && !video.seeking && !isScrubbingTimeline) {
          const t = video.currentTime || 0;
          const dur = currentDuration || 0;
          if (dur > 0) {
            const pct = Math.max(0, Math.min((t / dur) * 100, 100));
            if (playedRef.current) {
              playedRef.current.style.width = `${pct}%`;
            }
            if (rangeInputRef.current) {
              rangeInputRef.current.value = Math.min(t, dur);
            }
            if (timeTextRef.current) {
              timeTextRef.current.textContent = formatTime(t);
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
  }, [isPlaying, currentDuration, isScrubbingTimeline, formatTime, videoRef]);

  // Sync timeline DOM values when currentTime or duration updates from outside
  useEffect(() => {
    const range = rangeInputRef.current;
    const played = playedRef.current;
    const timeText = timeTextRef.current;
    const video = videoRef.current;
    
    if (range && !isScrubbingTimeline) {
      const actualTime = (video && Number.isFinite(video.currentTime)) ? video.currentTime : currentTime;
      const dur = currentDuration || (video && Number.isFinite(video.duration) ? video.duration : 0) || 0;
      range.value = Math.min(actualTime, dur);
      if (dur > 0) {
        const pct = Math.max(0, Math.min((actualTime / dur) * 100, 100));
        if (played) played.style.width = `${pct}%`;
      } else {
        if (played) played.style.width = '0%';
      }
      if (timeText) timeText.textContent = formatTime(actualTime);
    }
  }, [currentTime, currentDuration, isScrubbingTimeline, formatTime, effectiveIsVideoMinimized, videoRef]);

  // Native event listeners to ensure play/pause/ended state is updated correctly
  // even on mobile devices where native fullscreen intercepts React's synthetic events.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = (e) => {
      const playIcon = document.querySelector('#video-play-pause .icon-play-wrapper');
      const pauseIcon = document.querySelector('#video-play-pause .icon-pause-wrapper');
      if (playIcon) playIcon.style.display = 'none';
      if (pauseIcon) pauseIcon.style.display = 'inline-flex';
      
      const btn = document.getElementById('video-play-pause');
      if (btn) btn.setAttribute('aria-label', 'Pause');

      if (handleVideoPlay) handleVideoPlay(e);
    };

    const onPause = (e) => {
      const playIcon = document.querySelector('#video-play-pause .icon-play-wrapper');
      const pauseIcon = document.querySelector('#video-play-pause .icon-pause-wrapper');
      if (playIcon) playIcon.style.display = 'inline-flex';
      if (pauseIcon) pauseIcon.style.display = 'none';

      const btn = document.getElementById('video-play-pause');
      if (btn) btn.setAttribute('aria-label', 'Play');

      if (handleVideoPause) handleVideoPause(e);
    };

    const onEnded = (e) => {
      if (handleVideoEnded) handleVideoEnded(e);
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
    };
  }, [videoRef, handleVideoPlay, handleVideoPause, handleVideoEnded, selectedVideoSource]);

  const handleSeekChangeInstant = (e) => {
    const val = Number(e.target.value) || 0;
    const dur = currentDuration || 0;
    if (dur > 0) {
      const pct = Math.max(0, Math.min((val / dur) * 100, 100));
      if (playedRef.current) {
        playedRef.current.style.width = `${pct}%`;
      }
      if (timeTextRef.current) {
        timeTextRef.current.textContent = formatTime(val);
      }
    }
    handleSeekChange(e);
  };

  const handleSeekPreviewInstant = (e) => {
    const val = Number(e.target.value) || 0;
    const dur = currentDuration || 0;
    if (dur > 0) {
      const pct = Math.max(0, Math.min((val / dur) * 100, 100));
      if (playedRef.current) {
        playedRef.current.style.width = `${pct}%`;
      }
      if (timeTextRef.current) {
        timeTextRef.current.textContent = formatTime(val);
      }
    }
    handleSeekPreview(e);
  };

  // --- Sprite preview position calculation for video canvas ---
  const spritePreviewStyle = useMemo(() => {
    if (!spriteSheet) return null;
    const { interval, cols, url, totalFrames } = spriteSheet;
    if (!totalFrames || !cols) return null;
    const rows = Math.ceil(totalFrames / cols);
    const index = Math.min(
      Math.max(0, Math.floor((scrubPreviewTime || 0) / interval)),
      totalFrames - 1
    );
    const col = index % cols;
    const row = Math.floor(index / cols);
    const xPct = cols > 1 ? (col / (cols - 1)) * 100 : 0;
    const yPct = rows > 1 ? (row / (rows - 1)) * 100 : 0;

    return {
      backgroundImage: `url(${url})`,
      backgroundPosition: `${xPct}% ${yPct}%`,
      backgroundRepeat: 'no-repeat',
      backgroundSize: `${cols * 100}% ${rows * 100}%`,
    };
  }, [spriteSheet, scrubPreviewTime]);

  // --- Ambient Mode ---
  const ambientCanvasRef = useRef(null);
  const ambientFrameId = useRef(null);
  const ambientFailCount = useRef(0);
  // Some browsers (notably Firefox on Windows, when hardware video decoding
  // is active) cannot read a <video> frame into a 2D canvas: drawImage()
  // throws NS_ERROR_NOT_AVAILABLE / "Passed-in image is broken" on every
  // single frame. Rather than silently rendering nothing forever, we detect
  // that pattern after a few consecutive failures and switch to a static
  // blurred-poster fallback instead of an empty canvas.
  const AMBIENT_FAILURE_THRESHOLD = 6;
  const [ambientUnsupported, setAmbientUnsupported] = useState(false);

  // Give every newly selected video a fresh chance — the failure is a
  // browser/engine limitation, not something tied to a specific file, but
  // resetting per-video keeps this robust if that ever changes.
  useEffect(() => {
    ambientFailCount.current = 0;
    setAmbientUnsupported(false);
  }, [selectedVideoSource]);

  const paintAmbientFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = ambientCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    if (ambientFailCount.current >= AMBIENT_FAILURE_THRESHOLD) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (ambientFailCount.current > 0) {
        ambientFailCount.current = 0;
      }
    } catch (_) {
      // Ignore the individual error, but keep a tally so we can bail out
      // of this approach entirely if it never recovers.
      ambientFailCount.current += 1;
      if (ambientFailCount.current === AMBIENT_FAILURE_THRESHOLD) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn(
            '[Ambient Mode] Canvas cannot read video frames in this browser ' +
            '(known Firefox/hardware-decoding limitation). Falling back to a ' +
            'static blurred poster.'
          );
        }
        setAmbientUnsupported(true);
      }
    }
  }, [videoRef]);

  const lastAmbientDrawRef = useRef(0);
  const drawAmbientFrame = useCallback(() => {
    if (!shouldShowAmbient || ambientFailCount.current >= AMBIENT_FAILURE_THRESHOLD) {
      ambientFrameId.current = null;
      return;
    }
    const video = videoRef.current;
    if (video && !video.paused && !video.ended && video.readyState >= 2) {
      const now = performance.now();
      if (now - lastAmbientDrawRef.current >= 100) { // Throttle ambient canvas updates to 10 FPS to preserve native 60fps video playback
        lastAmbientDrawRef.current = now;
        paintAmbientFrame();
      }
    }
    if (ambientFailCount.current >= AMBIENT_FAILURE_THRESHOLD) {
      ambientFrameId.current = null;
      return;
    }
    ambientFrameId.current = requestAnimationFrame(drawAmbientFrame);
  }, [videoRef, shouldShowAmbient, paintAmbientFrame]);

  useEffect(() => {
    if (!shouldShowAmbient) {
      if (ambientFrameId.current) {
        cancelAnimationFrame(ambientFrameId.current);
        ambientFrameId.current = null;
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      if (!ambientFrameId.current) drawAmbientFrame();
    };

    const onPause = () => {
      if (ambientFrameId.current) {
        cancelAnimationFrame(ambientFrameId.current);
        ambientFrameId.current = null;
      }
    };

    const onFrameAvailable = () => {
      paintAmbientFrame();
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('loadedmetadata', onFrameAvailable);
    video.addEventListener('loadeddata', onFrameAvailable);
    video.addEventListener('canplay', onFrameAvailable);
    video.addEventListener('seeked', onFrameAvailable);
    video.addEventListener('timeupdate', onFrameAvailable);

    // Paint immediately for paused/restored mobile videos, then animate while playing.
    paintAmbientFrame();
    if (!video.paused && !video.ended) {
      drawAmbientFrame();
    }

    return () => {
      if (ambientFrameId.current) {
        cancelAnimationFrame(ambientFrameId.current);
        ambientFrameId.current = null;
      }
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('loadedmetadata', onFrameAvailable);
      video.removeEventListener('loadeddata', onFrameAvailable);
      video.removeEventListener('canplay', onFrameAvailable);
      video.removeEventListener('seeked', onFrameAvailable);
      video.removeEventListener('timeupdate', onFrameAvailable);
    };
  }, [videoRef, drawAmbientFrame, paintAmbientFrame, shouldShowAmbient]);

  const footerTouchStartYRef = useRef(null);

  const handleFooterTouchStart = (e) => {
    if (e.touches && e.touches.length === 1) {
      footerTouchStartYRef.current = e.touches[0].clientY;
    }
  };

  const handleFooterTouchMove = (e) => {
    if (footerTouchStartYRef.current !== null && e.touches && e.touches.length === 1) {
      const deltaY = e.touches[0].clientY - footerTouchStartYRef.current;
      if (deltaY > 25) {
        footerTouchStartYRef.current = null;
        if (typeof setControlsVisible === 'function') {
          setControlsVisible(false);
        }
      }
    }
  };

  const handleFooterTouchEnd = () => {
    footerTouchStartYRef.current = null;
  };

  const shouldHideControls = !controlsVisible && isVideoFullscreenView;

  return (
    <section
      className={
        'video-player-container select-none' +
        (isMobileViewport ? ' video-mobile-viewport' : '') +
        (isFullscreen ? ' video-player-fullscreen' : '') +
        (isWindowFullscreen ? ' video-player-window-fullscreen' : '') +
        (isPortraitVideo ? ' video-portrait' : '') +
        (shouldUseNormalAmbientLayout ? ' video-normal-ambient' : '') +
        (shouldHideControls ? ' video-cursor-hidden' : '') +
        (effectiveIsVideoMinimized ? ' video-player-minimized' : '')
      }
      style={{ '--video-aspect-ratio': videoAspectRatio }}
      ref={videoContainerRef}
      hidden={!selectedVideo}
      onMouseMove={handleContainerMouseMove}
      onClick={(e) => {
        if (effectiveIsVideoMinimized && onMinimizeToggle) {
          onMinimizeToggle(false);
        }
      }}
    >
      {selectedVideo && (
        <>
          <div
            className="video-screen-area select-none"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDoubleClick={handleDoubleClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onClick={(e) => {
              if (effectiveIsVideoMinimized && onMinimizeToggle) {
                e.stopPropagation();
                onMinimizeToggle(false);
              }
            }}
            style={{
              cursor: isPinchZoomEnabled
                ? zoomScale > 1
                  ? isMouseDragging
                    ? 'grabbing'
                    : 'grab'
                  : 'crosshair'
                : undefined,
            }}
          >
            {isPinchZoomEnabled && isVideoFullscreenView && (
              (isTrueMobileDevice || isMobileViewport) ? (
                <button
                  type="button"
                  className="video-zoom-floating-bar video-zoom-mobile-exit select-none"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsPinchZoomEnabled(false);
                    setZoomScale(1);
                    setPanPosition({ x: 0, y: 0 });
                  }}
                  onTouchStart={(e) => {
                    e.stopPropagation();
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsPinchZoomEnabled(false);
                    setZoomScale(1);
                    setPanPosition({ x: 0, y: 0 });
                  }}
                  title="Exit Pinch Zoom"
                >
                  <ZoomOut size={15} />
                  <span>Exit Zoom{zoomScale > 1 ? ` (${zoomScale.toFixed(1)}x)` : ''}</span>
                </button>
              ) : (
                <div
                  className="video-zoom-floating-bar select-none"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="video-zoom-bar-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      const newZoom = Math.max(1, zoomScale - 0.5);
                      setZoomScale(newZoom);
                      setPanPosition((prev) => clampPan(prev.x, prev.y, newZoom));
                    }}
                    disabled={zoomScale <= 1}
                    title="Zoom Out (-)"
                  >
                    <ZoomOut size={15} />
                  </button>

                  <span className="video-zoom-bar-text">
                    {zoomScale.toFixed(1)}x
                  </span>

                  <button
                    type="button"
                    className="video-zoom-bar-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setZoomScale(1);
                      setPanPosition({ x: 0, y: 0 });
                    }}
                    title="Reset Zoom"
                  >
                    <RotateCw size={14} />
                  </button>

                  <button
                    type="button"
                    className="video-zoom-bar-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      const newZoom = Math.min(4.5, zoomScale + 0.5);
                      setZoomScale(newZoom);
                      setPanPosition((prev) => clampPan(prev.x, prev.y, newZoom));
                    }}
                    disabled={zoomScale >= 4.5}
                    title="Zoom In (+)"
                  >
                    <ZoomIn size={15} />
                  </button>

                  <div className="video-zoom-bar-divider" />

                  <button
                    type="button"
                    className="video-zoom-bar-btn exit-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsPinchZoomEnabled(false);
                      setZoomScale(1);
                      setPanPosition({ x: 0, y: 0 });
                    }}
                    title="Turn off Zoom Mode"
                  >
                    <X size={15} />
                    <span>Exit Zoom</span>
                  </button>
                </div>
              )
            )}
            {/* Ambient glow — canvas path on browsers that support reading
                video frames into 2D canvas; falls back to a static blurred
                poster image on browsers that don't (e.g. Firefox/Windows
                with hardware video decoding, see paintAmbientFrame above). */}
            {shouldShowAmbient && (
              ambientUnsupported && selectedVideoPoster ? (
                <div
                  className={`ambient-canvas ambient-canvas--image select-none ${shouldShowAmbient ? 'ambient-canvas-active' : ''}`}
                  style={{ backgroundImage: `url(${selectedVideoPoster})` }}
                  aria-hidden="true"
                />
              ) : (
                <canvas
                  ref={ambientCanvasRef}
                  width="64"
                  height="36"
                  className={`ambient-canvas select-none ${shouldShowAmbient && !ambientUnsupported ? 'ambient-canvas-active' : ''}`}
                  aria-hidden="true"
                />
              )
            )}

            <video
              ref={videoRef}
              src={selectedVideoSource}
              preload="auto"
              poster={selectedVideoPoster || undefined}
              loop={isLooping}
              playsInline={true}
              webkit-playsinline="true"
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={(e) => {
                if (videoRef.current) videoRef.current.playbackRate = playbackRate;
                if (handleLoadedMetadata) handleLoadedMetadata(e);
              }}
              onDurationChange={handleDurationChange}
              onProgress={handleProgress}
              onPlay={handleVideoPlay}
              onPause={handleVideoPause}
              onEnded={handleVideoEnded}
              className="select-none"
              style={{
                objectFit: videoScaleMode,
                willChange: 'transform',
                transform: zoomScale > 1 || panPosition.x !== 0 || panPosition.y !== 0
                  ? `translate3d(${panPosition.x}px, ${panPosition.y}px, 0px) scale(${zoomScale})`
                  : 'translateZ(0)'
              }}
            />

            {(isSeekPreviewVisible || isScrubbingTimeline) && (
              <div className="video-canvas-preview-overlay select-none" aria-hidden="true">
                {spritePreviewStyle ? (
                  <div
                    className="video-canvas-preview-sprite select-none"
                    style={spritePreviewStyle}
                  />
                ) : (
                  <video
                    ref={seekPreviewVideoRef}
                    src={selectedVideoSource}
                    poster={selectedVideoPoster || undefined}
                    muted
                    playsInline
                    preload="metadata"
                    className="video-canvas-preview-video select-none"
                  />
                )}
                <div className="video-canvas-preview-badge select-none">
                  {formatTime(scrubPreviewTime)}
                </div>
              </div>
            )}

            <div 
              className="video-touch-overlay select-none" 
              style={{ 
                position: 'absolute', 
                inset: 0, 
                zIndex: 1, 
                width: '100%', 
                height: '100%' 
              }} 
            />

            {keyboardActionHint && (
              <div className="video-shortcut-hint select-none" role="status" aria-live="polite" style={{ zIndex: 2 }}>
                {actionIcons[keyboardActionHint]}
              </div>
            )}
          </div>

          {effectiveIsVideoMinimized ? (
            <div
              className="video-mini-controls select-none"
              onClick={() => {
                if (onMinimizeToggle) onMinimizeToggle(false);
              }}
            >
              {selectedVideo && (
                <div
                  className="player-background select-none"
                  style={{ backgroundImage: `url(${selectedVideoPoster})` }}
                />
              )}
              <div className="player-overlay select-none" />
              <div className="mini-info select-text">
                <button
                  type="button"
                  className="mini-title select-text"
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    margin: 0,
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: 'inherit',
                    fontWeight: 650,
                    fontSize: '0.82rem',
                    lineHeight: 1.2,
                    display: 'block',
                    width: '100%',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (typeof scrollToCurrent === 'function') {
                      scrollToCurrent();
                    }
                  }}
                  title="Scroll to current video in list"
                >
                  {selectedVideo ? pickTitle(selectedVideo) : ''}
                </button>
                <div className="mini-folder select-text">
                  {formatTime(currentTime)}
                </div>
              </div>
              <div className="mini-actions select-none">
                <button
                  type="button"
                  className="mini-play-pause select-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePlayPause();
                  }}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause size={14} fill="currentColor" stroke="none" />
                  ) : (
                    <Play size={14} fill="currentColor" stroke="none" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <footer
              className={
                'player video-player-footer select-none' +
                (isVideoFullscreenView ? ' video-footer-floating' : '') +
                (isEdgeToastActive ? ' video-footer-edge-mobile' : '') +
                (shouldHideControls ? ' video-footer-hidden' : '')
              }
              id="video-player"
              onMouseEnter={isVideoFullscreenView ? () => { setControlsVisible(true); clearHideTimer(); } : undefined}
              onMouseLeave={isVideoFullscreenView ? () => { resetHideTimer(); } : undefined}
              onTouchStart={handleFooterTouchStart}
              onTouchMove={handleFooterTouchMove}
              onTouchEnd={handleFooterTouchEnd}
            >
              {selectedVideo && (
                <div
                  className="player-background select-none"
                  style={{ backgroundImage: `url(${selectedVideoPoster})` }}
                />
              )}
              <div className="player-overlay select-none" />
              <div className="player-content select-none">
                <div className="player-main select-none">
                  <div className="player-info select-text">
                    <div id="video-current-title" className="player-title select-text">
                      {MarqueeText ? (
                        <MarqueeText
                          className="player-title-button select-text"
                          onClick={scrollToCurrent}
                          text={selectedVideo ? pickTitle(selectedVideo) : ''}
                          enabled={true}
                        />
                      ) : (
                        <button
                          type="button"
                          className="player-title-button select-text"
                          onClick={scrollToCurrent}
                        >
                          {selectedVideo ? pickTitle(selectedVideo) : ''}
                        </button>
                      )}
                    </div>

                  </div>
                </div>
                <div className="player-timeline select-none" aria-label="Video playback timeline">
                  <span ref={timeTextRef} className="player-time select-none">
                    {formatTime(isScrubbingTimeline ? scrubPreviewTime : currentTime)}
                  </span>
                  <div className={`player-seekbar-wrap select-none${isScrubbingTimeline ? ' is-scrubbing' : ''}${isPlaying ? ' is-playing' : ''}`}>
                    <div className="seekbar-custom-track select-none" />
                    <div
                      className="seekbar-custom-buffered select-none"
                      style={{
                        width: `${Math.max(0, Math.min((bufferedTime / (currentDuration || 1)) * 100, 100))}%`,
                      }}
                    />
                    <div
                      ref={playedRef}
                      className="seekbar-custom-played select-none"
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(
                            ((isScrubbingTimeline ? scrubPreviewTime : currentTime) /
                              (currentDuration || 1)) *
                              100,
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
                      max={currentDuration || 0}
                      value={isScrubbingTimeline ? scrubPreviewTime : Math.min((videoRef.current && Number.isFinite(videoRef.current.currentTime)) ? videoRef.current.currentTime : currentTime, currentDuration || 0)}
                      step="any"
                      onChange={handleSeekChangeInstant}
                      onInput={handleSeekPreviewInstant}
                      onMouseDown={beginTimelineScrub}
                      onMouseUp={endTimelineScrub}
                      onMouseMove={handleSeekHover}
                      onMouseLeave={handleSeekMouseLeave}
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        beginTimelineScrub();
                      }}
                      onTouchEnd={endTimelineScrub}
                      onPointerDown={beginTimelineScrub}
                      onPointerUp={endTimelineScrub}
                      onPointerCancel={endTimelineScrub}
                      onBlur={hideSeekPreviewSoon}
                      style={{ touchAction: 'none' }}
                    />
                  </div>
                  <span className="player-time select-none">{formatTime(currentDuration)}</span>
                </div>
                <div className="player-controls-row select-none">
                  <div className="player-left-actions select-none" aria-label="Left controls">
                    <DropdownMenu onOpenChange={(open) => { if (!open) setMenuView('main'); }}>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="icon-button player-more-button select-none"
                          aria-label="More options"
                          title="More options"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical size={18} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        side="top"
                        sideOffset={12}
                        container={videoContainerRef.current || undefined}
                        className="video-settings-dropdown select-none"
                      >
                        {menuView === 'main' && (
                          <div className="flex flex-col gap-0.5">
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault();
                                toggleLooping();
                              }}
                              className="video-menu-item"
                            >
                              <div className="video-menu-item-left">
                                <Repeat size={16} className="text-indigo-400" />
                                <span>Loop Video (L)</span>
                              </div>
                              <span className={`video-menu-pill ${isLooping ? 'active' : ''}`}>
                                {isLooping ? 'On' : 'Off'}
                              </span>
                            </DropdownMenuItem>

                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault();
                                setMenuView('speed');
                              }}
                              className="video-menu-item"
                            >
                              <div className="video-menu-item-left">
                                <Gauge size={16} className="text-sky-400" />
                                <span>Speed</span>
                              </div>
                              <div className="video-menu-item-right">
                                <span className="video-menu-pill">
                                  {playbackRate === 1 ? '1x' : `${playbackRate}x`}
                                </span>
                                <ChevronRight size={14} className="text-slate-400 opacity-70" />
                              </div>
                            </DropdownMenuItem>

                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault();
                                setMenuView('scaling');
                              }}
                              className="video-menu-item"
                            >
                              <div className="video-menu-item-left">
                                <Scaling size={16} className="text-amber-400" />
                                <span>Scaling</span>
                              </div>
                              <div className="video-menu-item-right">
                                <span className="video-menu-pill">
                                  {videoScaleMode === 'contain' ? 'Fit' : videoScaleMode === 'fill' ? 'Stretch' : 'Crop'}
                                </span>
                                <ChevronRight size={14} className="text-slate-400 opacity-70" />
                              </div>
                            </DropdownMenuItem>

                            {isVideoFullscreenView && (
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  setIsPinchZoomEnabled((prev) => !prev);
                                }}
                                className="video-menu-item"
                              >
                                <div className="video-menu-item-left">
                                  <ZoomIn size={16} className="text-pink-400" />
                                  <span>Canvas Zoom</span>
                                </div>
                                <span className={`video-menu-pill ${isPinchZoomEnabled ? 'active' : ''}`}>
                                  {isPinchZoomEnabled ? 'On' : 'Off'}
                                </span>
                              </DropdownMenuItem>
                            )}

                            <DropdownMenuSeparator className="my-1 bg-slate-700/50" />

                            <DropdownMenuItem
                              onSelect={() => {
                                toggleFloatingWindow();
                              }}
                              disabled={!supportsFloatingWindow}
                              className="video-menu-item"
                            >
                              <div className="video-menu-item-left">
                                <PictureInPicture2 size={16} className="text-emerald-400" />
                                <span>Picture-in-Picture (P)</span>
                              </div>
                            </DropdownMenuItem>
                          </div>
                        )}

                        {menuView === 'speed' && (
                          <div className="flex flex-col gap-0.5">
                            <div className="video-menu-header">
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  setMenuView('main');
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMenuView('main');
                                }}
                                className="video-menu-back-btn"
                              >
                                <ChevronLeft size={16} />
                                <span>Playback Speed</span>
                              </button>
                            </div>
                            <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto custom-scrollbar">
                              {SPEED_OPTIONS.map((speed) => (
                                <DropdownMenuItem
                                  key={speed}
                                  onSelect={() => {
                                    handleRateChange(speed);
                                  }}
                                  className="video-menu-item"
                                >
                                  <span>{speed === 1 ? '1x (Normal)' : `${speed}x`}</span>
                                  {playbackRate === speed && <Check size={14} className="text-emerald-400" />}
                                </DropdownMenuItem>
                              ))}
                            </div>
                          </div>
                        )}

                        {menuView === 'scaling' && (
                          <div className="flex flex-col gap-0.5">
                            <div className="video-menu-header">
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  setMenuView('main');
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMenuView('main');
                                }}
                                className="video-menu-back-btn"
                              >
                                <ChevronLeft size={16} />
                                <span>Video Scaling</span>
                              </button>
                            </div>
                            <DropdownMenuItem
                              onSelect={() => {
                                handleScaleChange('contain');
                              }}
                              className="video-menu-item"
                            >
                              <div>
                                <div>Fit inside</div>
                                <div className="video-menu-option-desc">Black bars, original ratio</div>
                              </div>
                              {videoScaleMode === 'contain' && <Check size={14} className="text-amber-400" />}
                            </DropdownMenuItem>

                            <DropdownMenuItem
                              onSelect={() => {
                                handleScaleChange('fill');
                              }}
                              className="video-menu-item"
                            >
                              <div>
                                <div>Stretch to fit</div>
                                <div className="video-menu-option-desc">Fill area, stretched</div>
                              </div>
                              {videoScaleMode === 'fill' && <Check size={14} className="text-amber-400" />}
                            </DropdownMenuItem>

                            <DropdownMenuItem
                              onSelect={() => {
                                handleScaleChange('cover');
                              }}
                              className="video-menu-item"
                            >
                              <div>
                                <div>Crop to fit</div>
                                <div className="video-menu-option-desc">Fill area, cropped edges</div>
                              </div>
                              {videoScaleMode === 'cover' && <Check size={14} className="text-amber-400" />}
                            </DropdownMenuItem>
                          </div>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="player-controls select-none" aria-label="Video playback controls">
                    <button
                      type="button"
                      className="icon-button select-none"
                      aria-label="Previous video"
                      onClick={goToPreviousVideo}
                    >
                      <SkipBack size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-button select-none"
                      aria-label="Rewind 10 seconds"
                      onClick={() => skipVideoRelative(-10)}
                    >
                      <Rewind size={18} />
                    </button>
                    <button
                      id="video-play-pause"
                      type="button"
                      className="icon-button play-main select-none"
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                      onClick={togglePlayPause}
                    >
                      <span className="icon-pause-wrapper" style={{ display: isPlaying ? 'inline-flex' : 'none' }}>
                        <Pause size={20} fill="currentColor" stroke="none" />
                      </span>
                      <span className="icon-play-wrapper" style={{ display: isPlaying ? 'none' : 'inline-flex' }}>
                        <Play size={20} fill="currentColor" stroke="none" />
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-button select-none"
                      aria-label="Fast forward 10 seconds"
                      onClick={() => skipVideoRelative(10)}
                    >
                      <FastForward size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-button select-none"
                      aria-label="Next video"
                      onClick={goToNextVideo}
                    >
                      <SkipForward size={18} />
                    </button>
                  </div>
                  <div className="player-side-actions select-none" aria-label="View controls">
                    {isTrueMobileDevice && isVideoFullscreenView && (
                      <button
                        type="button"
                        className="icon-button select-none"
                        aria-label="Rotate screen"
                        title="Rotate Screen"
                        onClick={handleManualRotate}
                      >
                        <RotateCw size={18} />
                      </button>
                    )}
                    {canMinimize && !isVideoFullscreenView && (
                      <button
                        type="button"
                        className="icon-button player-minimize-button select-none"
                        aria-label="Minimize video player"
                        title="Minimize Video"
                        onClick={() => onMinimizeToggle && onMinimizeToggle(true)}
                      >
                        <ChevronDown size={18} />
                      </button>
                    )}
                    {canUseWindowFullscreen && (
                      <button
                        type="button"
                        className={`icon-button player-floating-button video-player-window-fullscreen-button select-none ${isWindowFullscreen ? 'toggle-active' : ''}`}
                        aria-label={isWindowFullscreen ? 'Exit windowed fullscreen' : 'Windowed fullscreen'}
                        title="Windowed Fullscreen (W)"
                        onClick={toggleWindowFullscreen}
                      >
                        <AppWindow size={18} />
                      </button>
                    )}
                    <button
                      type="button"
                      className={`icon-button player-fullscreen-button select-none ${isFullscreen ? 'toggle-active' : ''}`}
                      aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                      onClick={toggleFullscreen}
                    >
                      {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                    </button>
                  </div>
                </div>
              </div>
            </footer>
          )}
        </>
      )}
    </section>
  );
}
