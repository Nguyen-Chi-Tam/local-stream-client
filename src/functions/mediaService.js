import { useState, useCallback } from 'react';

/**
 * Custom React hook to manage state and controls for HTMLMediaElement (audio/video).
 * 
 * @param {React.RefObject<HTMLMediaElement>} mediaRef Ref to the audio or video element.
 */
export function useMediaPlayer(mediaRef) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentDuration, setCurrentDuration] = useState(0);
  const [bufferedTime, setBufferedTime] = useState(0);

  const updateBufferedTime = useCallback(() => {
    const el = mediaRef.current;
    if (!el || !el.buffered) return;
    const buffered = el.buffered;
    const t = el.currentTime || 0;

    let currentBufferedEnd = 0;
    for (let i = 0; i < buffered.length; i++) {
      const start = buffered.start(i);
      const end = buffered.end(i);
      if (start <= t + 2 && t <= end + 2) {
        if (end > currentBufferedEnd) {
          currentBufferedEnd = end;
        }
      }
    }
    setBufferedTime(currentBufferedEnd);
  }, [mediaRef]);

  const togglePlayPause = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => setIsPlaying(false));
    } else {
      el.pause();
    }
  }, [mediaRef]);

  const skipRelative = useCallback((deltaSeconds) => {
    const el = mediaRef.current;
    if (!el) return;
    const duration = Number.isFinite(el.duration) ? el.duration : 0;
    const rawTime = (el.currentTime || 0) + deltaSeconds;
    const clampedTime = duration
      ? Math.max(0, Math.min(rawTime, duration))
      : Math.max(0, rawTime);

    el.currentTime = clampedTime;
    setCurrentTime(clampedTime);
  }, [mediaRef]);

  const seekTo = useCallback((targetTime) => {
    const el = mediaRef.current;
    if (!el) return;
    const duration = Number.isFinite(el.duration) ? el.duration : 0;
    const clamped = duration > 0
      ? Math.min(duration, Math.max(0, Number(targetTime) || 0))
      : Math.max(0, Number(targetTime) || 0);

    try {
      el.currentTime = clamped;
    } catch {
      // Ignore internal seek errors
    }
    setCurrentTime(clamped);
  }, [mediaRef]);

  return {
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
  };
}
