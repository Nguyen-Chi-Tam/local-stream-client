/**
 * Client-side sprite sheet generator for video seek preview.
 *
 * Instead of seeking a hidden <video> element on every hover (slow, network-
 * dependent), this module captures frames from the video at regular intervals
 * and stitches them into a single sprite-sheet image.  The seek preview then
 * shows the correct cell via CSS `background-position` — zero latency.
 *
 * Usage:
 *   const ctrl = generateSpriteSheet(videoSrc, { onProgress });
 *   const sprite = await ctrl.promise;   // null on failure / cancellation
 *   ctrl.cancel();                        // abort in-flight generation
 *
 * The returned sprite object (when successful):
 *   { url, cols, rows, thumbWidth, thumbHeight, interval, totalFrames }
 */

// ── Configuration ───────────────────────────────────────────────────────

const THUMB_WIDTH = 160;
const GRID_COLUMNS = 10;
const MAX_FRAMES = 200;          // cap to keep memory reasonable
const MIN_INTERVAL_SEC = 5;      // never capture more often than every 5 s
const DEFAULT_INTERVAL_SEC = 10; // for short videos (< 33 min)

// ── Cache ───────────────────────────────────────────────────────────────

const spriteCache = new Map();   // videoSrc → { spriteInfo, blobUrl }

export function getCachedSprite(videoSrc) {
  return spriteCache.get(videoSrc)?.spriteInfo ?? null;
}

export function clearSpriteCache(videoSrc) {
  if (videoSrc) {
    const entry = spriteCache.get(videoSrc);
    if (entry?.blobUrl) URL.revokeObjectURL(entry.blobUrl);
    spriteCache.delete(videoSrc);
  } else {
    for (const entry of spriteCache.values()) {
      if (entry?.blobUrl) URL.revokeObjectURL(entry.blobUrl);
    }
    spriteCache.clear();
  }
}

// ── Generator ───────────────────────────────────────────────────────────

/**
 * @param {string}   videoSrc         The video source URL.
 * @param {object}   [options]
 * @param {function} [options.onProgress]  Called with (framesCaptures, totalFrames).
 * @returns {{ promise: Promise<object|null>, cancel: () => void }}
 */
export function generateSpriteSheet(videoSrc, options = {}) {
  const { onProgress } = options;
  let cancelled = false;

  // Return cached result immediately if available.
  const cached = getCachedSprite(videoSrc);
  if (cached) {
    return {
      promise: Promise.resolve(cached),
      cancel: () => {},
    };
  }

  const cancel = () => { cancelled = true; };

  const promise = _generate(videoSrc, () => cancelled, onProgress);

  return { promise, cancel };
}

// ── Internal ────────────────────────────────────────────────────────────

async function _generate(videoSrc, isCancelled, onProgress) {
  if (!videoSrc) return null;

  // 1. Create a dedicated hidden video element for frame capture.
  const video = document.createElement('video');
  video.style.position = 'absolute';
  video.style.width = '1px';
  video.style.height = '1px';
  video.style.opacity = '0';
  video.style.pointerEvents = 'none';
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  video.src = videoSrc;
  document.body.appendChild(video);
  video.load();

  try {
    // 2. Wait for metadata so we know the duration.
    await _waitForEvent(video, 'loadeddata', 'error', 15_000);
    if (isCancelled()) return null;

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return null;

    // 3. Determine capture interval & grid dimensions.
    let interval = DEFAULT_INTERVAL_SEC;
    const rawFrameCount = Math.floor(duration / interval);
    if (rawFrameCount > MAX_FRAMES) {
      interval = Math.ceil(duration / MAX_FRAMES);
    }
    interval = Math.max(MIN_INTERVAL_SEC, interval);

    const totalFrames = Math.max(1, Math.floor(duration / interval) + 1);
    const cols = Math.min(totalFrames, GRID_COLUMNS);
    const rows = Math.ceil(totalFrames / cols);

    const videoWidth = video.videoWidth || 160;
    const videoHeight = video.videoHeight || 90;
    const thumbHeight = Math.max(1, Math.round(THUMB_WIDTH * (videoHeight / videoWidth)));

    // 4. Prepare canvas.
    const canvas = document.createElement('canvas');
    canvas.width = cols * THUMB_WIDTH;
    canvas.height = rows * thumbHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Fill with a dark background so empty cells aren't transparent.
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 5. Capture frames.
    let capturedCount = 0;
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 4;

    for (let i = 0; i < totalFrames; i++) {
      if (isCancelled()) return null;

      const seekTime = Math.min(i * interval, duration - 0.1);

      try {
        await _seekTo(video, seekTime);
      } catch {
        // Seek failed — skip this frame.
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          // Too many failures in a row → this video/browser can't do canvas
          // capture reliably (e.g. CORS, Firefox HW decode). Bail out.
          return null;
        }
        continue;
      }

      if (isCancelled()) return null;

      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * THUMB_WIDTH;
      const y = row * thumbHeight;

      try {
        ctx.drawImage(video, x, y, THUMB_WIDTH, thumbHeight);
        capturedCount++;
        consecutiveFailures = 0;
      } catch {
        // drawImage failure (tainted canvas, NS_ERROR_NOT_AVAILABLE, etc.)
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          return null;
        }
      }

      if (onProgress) {
        try { onProgress(capturedCount, totalFrames); } catch { /* ignore */ }
      }
    }

    if (isCancelled()) return null;
    if (capturedCount === 0) return null;

    // 6. Export canvas to blob URL.
    const blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.7);
    });

    if (!blob || isCancelled()) return null;

    const blobUrl = URL.createObjectURL(blob);

    const spriteInfo = {
      url: blobUrl,
      cols,
      rows,
      thumbWidth: THUMB_WIDTH,
      thumbHeight: thumbHeight,
      interval,
      totalFrames,
      duration,
    };

    // 7. Cache result.
    spriteCache.set(videoSrc, { spriteInfo, blobUrl });

    return spriteInfo;
  } catch {
    // Any unexpected error → return null (caller will use video fallback).
    return null;
  } finally {
    // Cleanup the hidden video.
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (video.parentNode) {
      video.parentNode.removeChild(video);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function _waitForEvent(el, successEvent, errorEvent, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      el.removeEventListener(successEvent, onSuccess);
      if (errorEvent) el.removeEventListener(errorEvent, onError);
    };

    const onSuccess = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error(errorEvent)); };

    el.addEventListener(successEvent, onSuccess, { once: true });
    if (errorEvent) {
      el.addEventListener(errorEvent, onError, { once: true });
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('timeout'));
      }, timeoutMs);
    }
  });
}

function _seekTo(video, time) {
  return new Promise((resolve, reject) => {
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('seek-error')); };

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });

    // Timeout: if the seek doesn't complete in 8 s, consider it failed.
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('seek-timeout'));
    }, 8000);

    try {
      video.currentTime = time;
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}
