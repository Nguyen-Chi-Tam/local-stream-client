import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, X, Copy, ZoomIn, ZoomOut, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  getItemId,
  pickTitle,
  pickThumbnailUrl,
} from '../functions/mediaUtils.js';

const isElectron = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);

function pickPhotoSourceUrl(serverUrl, item) {
  const id = getItemId(item);
  const base = (serverUrl || '').replace(/\/$/, '');

  if (base && id != null) {
    return base + '/media/image/' + encodeURIComponent(id);
  }

  const directRaw =
    item &&
    (item.url ||
      item.streamUrl ||
      item.fileUrl ||
      item.location ||
      item.path ||
      item.filePath ||
      item.fullPath ||
      '');

  const text = String(directRaw || '').trim();
  if (!text) return '';

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) {
    return text;
  }

  if (!base) return text;

  if (text.startsWith('/')) {
    return base + text;
  }

  return base + '/' + text;
}

function buildPhotoFilename(item, fallbackUrl) {
  const title = pickTitle(item).trim() || 'photo';
  const safeTitle = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();

  try {
    const path = new URL(String(fallbackUrl || ''), window.location.href).pathname || '';
    const extMatch = path.match(/\.[a-zA-Z0-9]{2,6}$/);
    const ext = extMatch ? extMatch[0].toLowerCase() : '.jpg';
    return (safeTitle || 'photo') + ext;
  } catch {
    return (safeTitle || 'photo') + '.jpg';
  }
}

/**
 * PhotoViewPage – standalone routed page for fullscreen photo viewing.
 *
 * This replaces the old overlay approach so that Esc / browser-back simply
 * returns to the photo grid instead of tearing down the connection.
 */
export default function PhotoViewPage({
  serverUrl,
  initialPhotoId,
  photoList,
  onClose,
}) {
  const [currentIndex, setCurrentIndex] = useState(() => {
    const idx = photoList.findIndex((item) => getItemId(item) === initialPhotoId);
    return idx >= 0 ? idx : 0;
  });
  const [slideDirection, setSlideDirection] = useState('none');
  const [showCopiedToast, setShowCopiedToast] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [touchStartX, setTouchStartX] = useState(0);

  // Zoom and Pan state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const overlayRef = useRef(null);
  const imageRef = useRef(null);
  const dragStateRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    distance: 0,
    panX: 0,
    panY: 0
  });

  const zoomLevelRef = useRef(zoomLevel);
  zoomLevelRef.current = zoomLevel;
  const panRef = useRef(pan);
  panRef.current = pan;

  useEffect(() => {
    setIsTouchDevice(window.matchMedia('(pointer: coarse)').matches);
  }, []);

  // Wheel zoom handler (non-passive to allow preventDefault)
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    function handleWheel(e) {
      // Don't zoom if user is scrolling inside controls
      if (e.target.closest('.photo-overlay-zoom-controls, .photo-overlay-icon-button')) {
        return;
      }

      e.preventDefault();
      if (e.deltaY === 0) return;

      const prevZoom = zoomLevelRef.current;
      const factor = e.deltaY < 0 ? 1.18 : 0.85;
      let nextZoom = Math.max(1, Math.min(5, prevZoom * factor));

      if (nextZoom < 1.05) {
        nextZoom = 1;
      }

      if (nextZoom === 1) {
        setZoomLevel(1);
        setPan({ x: 0, y: 0 });
        dragStateRef.current.panX = 0;
        dragStateRef.current.panY = 0;
        return;
      }

      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - (rect.left + rect.width / 2);
      const cursorY = e.clientY - (rect.top + rect.height / 2);

      const prevPan = panRef.current;
      const scaleRatio = nextZoom / prevZoom;
      const nextPanX = cursorX - (cursorX - prevPan.x) * scaleRatio;
      const nextPanY = cursorY - (cursorY - prevPan.y) * scaleRatio;

      dragStateRef.current.panX = nextPanX;
      dragStateRef.current.panY = nextPanY;
      setPan({ x: nextPanX, y: nextPanY });
      setZoomLevel(nextZoom);
    }

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Current photo derived state
  const currentItem = photoList[currentIndex] || null;
  const currentPhotoUrl = currentItem
    ? pickPhotoSourceUrl(serverUrl, currentItem) || pickThumbnailUrl(serverUrl, currentItem)
    : '';
  const currentPhotoId = currentItem ? getItemId(currentItem) : null;

  // Reset zoom when photo changes
  useEffect(() => {
    setZoomLevel(1);
    setPan({ x: 0, y: 0 });
    dragStateRef.current = { isDragging: false, startX: 0, startY: 0, distance: 0, panX: 0, panY: 0 };
  }, [currentPhotoId]);

  function goBack() {
    onClose();
  }

  function goToPrevPhoto() {
    if (currentIndex > 0) {
      setSlideDirection('right');
      setCurrentIndex(currentIndex - 1);
    }
  }

  function goToNextPhoto() {
    if (currentIndex < photoList.length - 1) {
      setSlideDirection('left');
      setCurrentIndex(currentIndex + 1);
    }
  }

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(event) {
      const key = event.key;

      if (key === 'Escape') {
        goBack();
        return;
      }

      if (key === 'ArrowLeft') {
        event.preventDefault();
        goToPrevPhoto();
        return;
      }

      if (key === 'ArrowRight') {
        event.preventDefault();
        goToNextPhoto();
        return;
      }

      // Zoom shortcuts
      if (key === '+' || key === '=') {
        event.preventDefault();
        setZoomLevel((prev) => Math.min(5, prev + 0.5));
      } else if (key === '-') {
        event.preventDefault();
        setZoomLevel((prev) => {
          const newZoom = Math.max(1, prev - 0.5);
          if (newZoom === 1) {
            setPan({ x: 0, y: 0 });
            dragStateRef.current.panX = 0;
            dragStateRef.current.panY = 0;
          }
          return newZoom;
        });
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, photoList]);

  // Touch swipe handlers
  function handleTouchStart(e) {
    if (e.touches.length === 1) {
      setTouchStartX(e.touches[0].clientX);
    } else {
      setTouchStartX(null);
    }
  }

  function handleTouchEnd(e) {
    if (window.visualViewport && window.visualViewport.scale > 1.01) return;

    if (e.changedTouches.length === 1 && e.touches.length === 0 && touchStartX !== null) {
      const touchEndX = e.changedTouches[0].clientX;
      const diff = touchStartX - touchEndX;
      const minSwipeDistance = 50;

      if (Math.abs(diff) > minSwipeDistance) {
        if (diff > 0) {
          goToNextPhoto();
        } else {
          goToPrevPhoto();
        }
      }
    }
    setTouchStartX(null);
  }

  async function handleSaveCurrentPhoto() {
    if (!currentItem || !currentPhotoUrl) return;

    const filename = buildPhotoFilename(currentItem, currentPhotoUrl);

    try {
      const response = await fetch(currentPhotoUrl, { mode: 'cors' });
      if (!response.ok) throw new Error('Failed to fetch image');

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      const link = document.createElement('a');
      link.href = currentPhotoUrl;
      link.download = filename;
      link.target = '_blank';
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  function handleCopyCurrentPhoto() {
    if (!currentItem || !currentPhotoUrl) return;

    const blobPromise = fetch(currentPhotoUrl, { mode: 'cors' })
      .then((res) => {
        if (!res.ok) throw new Error('Fetch failed');
        return res.blob();
      })
      .then((blob) => {
        if (blob.type === 'image/png') return blob;
        return new Promise((resolve, reject) => {
          const img = new Image();
          const url = URL.createObjectURL(blob);
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            canvas.toBlob((pngBlob) => {
              URL.revokeObjectURL(url);
              if (pngBlob) resolve(pngBlob);
              else reject(new Error('Canvas conversion failed'));
            }, 'image/png');
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Image decode failed'));
          };
          img.src = url;
        });
      });

    try {
      navigator.clipboard.write([
        new window.ClipboardItem({
          'image/png': blobPromise
        })
      ]).then(() => {
        setShowCopiedToast(true);
        setTimeout(() => setShowCopiedToast(false), 2000);
      }).catch(err => {
        console.error('Clipboard write failed asynchronously:', err);
      });
    } catch (err) {
      console.error('Failed to initiate clipboard write:', err);
    }
  }

  if (!photoList || photoList.length === 0) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="photo-overlay"
      onClick={() => {
        if (dragStateRef.current.distance < 5) goBack();
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={(e) => {
        // Allow native pinch zoom on multi-touch
      }}
      onMouseDown={(e) => {
        if (zoomLevel > 1) {
          setIsDragging(true);
          dragStateRef.current.isDragging = true;
          dragStateRef.current.startX = e.clientX - pan.x;
          dragStateRef.current.startY = e.clientY - pan.y;
          dragStateRef.current.distance = 0;
        }
      }}
      onMouseMove={(e) => {
        if (dragStateRef.current.isDragging && zoomLevel > 1) {
          const newPanX = e.clientX - dragStateRef.current.startX;
          const newPanY = e.clientY - dragStateRef.current.startY;

          dragStateRef.current.panX = newPanX;
          dragStateRef.current.panY = newPanY;
          dragStateRef.current.distance += Math.abs(e.movementX) + Math.abs(e.movementY);

          if (imageRef.current) {
            imageRef.current.style.transform = `translate(${newPanX}px, ${newPanY}px) scale(${zoomLevel})`;
          }
        }
      }}
      onMouseUp={() => {
        if (dragStateRef.current.isDragging) {
          setIsDragging(false);
          dragStateRef.current.isDragging = false;
          setPan({ x: dragStateRef.current.panX, y: dragStateRef.current.panY });
          setTimeout(() => { dragStateRef.current.distance = 0; }, 50);
        }
      }}
      onMouseLeave={() => {
        if (dragStateRef.current.isDragging) {
          setIsDragging(false);
          dragStateRef.current.isDragging = false;
          setPan({ x: dragStateRef.current.panX, y: dragStateRef.current.panY });
          setTimeout(() => { dragStateRef.current.distance = 0; }, 50);
        }
      }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        touchAction: 'pinch-zoom',
        cursor: zoomLevel > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
        overflow: 'hidden'
      }}
    >
      {/* Close Button */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); goBack(); }}
        className="photo-overlay-icon-button photo-overlay-close-button"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
        }}
        aria-label="Close photo"
      >
        <X size={26} strokeWidth={2.75} />
      </button>

      {isElectron && (
        <>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleSaveCurrentPhoto();
            }}
            className="photo-overlay-icon-button photo-overlay-save-button"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              color: 'white',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
            }}
            aria-label="Save photo"
            title="Save photo"
          >
            <ArrowDownToLine size={24} strokeWidth={2.75} />
          </button>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleCopyCurrentPhoto();
            }}
            className="photo-overlay-icon-button photo-overlay-copy-button"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              color: 'white',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
            }}
            aria-label="Copy photo"
            title="Copy photo"
          >
            <Copy size={22} strokeWidth={2.75} />
          </button>
        </>
      )}

      {/* Photo Counter */}
      {photoList.length > 1 && (
        <div
          style={{
            position: 'absolute',
            bottom: isTouchDevice ? '1rem' : '5.5rem',
            left: '50%',
            transform: 'translateX(-50%)',
            color: 'rgba(255, 255, 255, 0.7)',
            fontSize: '0.9rem',
          }}
        >
          {currentIndex + 1} / {photoList.length}
        </div>
      )}

      {/* Preload adjacent photos for faster slideshow */}
      <div style={{ display: 'none' }}>
        {currentIndex > 0 && photoList[currentIndex - 1] && (
          <img
            src={pickPhotoSourceUrl(serverUrl, photoList[currentIndex - 1]) || pickThumbnailUrl(serverUrl, photoList[currentIndex - 1])}
            alt=""
          />
        )}
        {currentIndex + 1 < photoList.length && photoList[currentIndex + 1] && (
          <img
            src={pickPhotoSourceUrl(serverUrl, photoList[currentIndex + 1]) || pickThumbnailUrl(serverUrl, photoList[currentIndex + 1])}
            alt=""
          />
        )}
      </div>

      {/* Image Container for Entrance Animation */}
      <div
        key={currentPhotoId}
        className={
          slideDirection === 'left'
            ? 'photo-overlay-img photo-slide-from-right'
            : slideDirection === 'right'
              ? 'photo-overlay-img photo-slide-from-left'
              : 'photo-overlay-img photo-fade-in'
        }
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%'
        }}
      >
        <img
          ref={imageRef}
          src={currentPhotoUrl}
          alt="Full size photo"
          className="select-none"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (zoomLevel > 1) {
              setZoomLevel(1);
              setPan({ x: 0, y: 0 });
              dragStateRef.current.panX = 0;
              dragStateRef.current.panY = 0;
            } else {
              setZoomLevel(2.5);
              setPan({ x: 0, y: 0 });
              dragStateRef.current.panX = 0;
              dragStateRef.current.panY = 0;
            }
          }}
          onDragStart={(e) => e.preventDefault()}
          onError={(event) => {
            const img = event.currentTarget;
            if (img.dataset.fallbackApplied === 'true') return;
            img.dataset.fallbackApplied = 'true';
            if (currentItem) {
              const thumbUrl = pickThumbnailUrl(serverUrl, currentItem);
              if (thumbUrl && thumbUrl !== img.src) {
                img.src = thumbUrl;
              }
            }
          }}
          style={{
            pointerEvents: 'auto',
            WebkitTouchCallout: 'default',
            maxWidth: isTouchDevice ? '90%' : '85%',
            maxHeight: isTouchDevice ? '90%' : '78%',
            objectFit: 'contain',
            userSelect: 'none',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomLevel})`,
            transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
            willChange: 'transform'
          }}
        />
      </div>

      {/* Zoom Controls (Non-touch devices) */}
      {!isTouchDevice && (
        <div
          className="photo-overlay-zoom-controls"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            bottom: '1.5rem',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(10px)',
            padding: '0.6rem 1.2rem',
            borderRadius: '999px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            zIndex: 1005
          }}
        >
          <button
            type="button"
            className="photo-overlay-icon-button"
            style={{
              position: 'relative',
              top: 0,
              width: '2.5rem',
              height: '2.5rem',
              backgroundColor: 'transparent',
              boxShadow: 'none'
            }}
            onClick={(e) => {
              e.stopPropagation();
              goToPrevPhoto();
            }}
            disabled={currentIndex <= 0}
            aria-label="Previous photo"
          >
            <ChevronLeft
              size={24}
              strokeWidth={2.75}
              color="white"
              style={{ opacity: currentIndex <= 0 ? 0.3 : 0.9 }}
            />
          </button>

          <button
            type="button"
            className="photo-overlay-icon-button"
            style={{
              position: 'relative',
              top: 0,
              width: '2.5rem',
              height: '2.5rem',
              backgroundColor: 'transparent',
              boxShadow: 'none'
            }}
            onClick={(e) => {
              e.stopPropagation();
              const newZoom = Math.max(1, zoomLevel - 0.5);
              setZoomLevel(newZoom);
              if (newZoom === 1) {
                setPan({ x: 0, y: 0 });
                dragStateRef.current.panX = 0;
                dragStateRef.current.panY = 0;
              }
            }}
            disabled={zoomLevel <= 1}
            aria-label="Zoom out"
          >
            <ZoomOut
              size={20}
              strokeWidth={2.75}
              color="white"
              style={{ opacity: zoomLevel <= 1 ? 0.3 : 0.9 }}
            />
          </button>

          <button
            type="button"
            className="photo-overlay-icon-button"
            style={{
              position: 'relative',
              top: 0,
              width: '2.5rem',
              height: '2.5rem',
              backgroundColor: 'transparent',
              boxShadow: 'none'
            }}
            onClick={(e) => {
              e.stopPropagation();
              setZoomLevel(1);
              setPan({ x: 0, y: 0 });
              dragStateRef.current.panX = 0;
              dragStateRef.current.panY = 0;
            }}
            aria-label="Reset zoom"
          >
            <RefreshCw size={18} strokeWidth={2.75} color="white" style={{ opacity: 0.9 }} />
          </button>

          <button
            type="button"
            className="photo-overlay-icon-button"
            style={{
              position: 'relative',
              top: 0,
              width: '2.5rem',
              height: '2.5rem',
              backgroundColor: 'transparent',
              boxShadow: 'none'
            }}
            onClick={(e) => {
              e.stopPropagation();
              setZoomLevel(Math.min(5, zoomLevel + 0.5));
            }}
            disabled={zoomLevel >= 5}
            aria-label="Zoom in"
          >
            <ZoomIn
              size={20}
              strokeWidth={2.75}
              color="white"
              style={{ opacity: zoomLevel >= 5 ? 0.3 : 0.9 }}
            />
          </button>

          <button
            type="button"
            className="photo-overlay-icon-button"
            style={{
              position: 'relative',
              top: 0,
              width: '2.5rem',
              height: '2.5rem',
              backgroundColor: 'transparent',
              boxShadow: 'none'
            }}
            onClick={(e) => {
              e.stopPropagation();
              goToNextPhoto();
            }}
            disabled={currentIndex >= photoList.length - 1}
            aria-label="Next photo"
          >
            <ChevronRight
              size={24}
              strokeWidth={2.75}
              color="white"
              style={{ opacity: currentIndex >= photoList.length - 1 ? 0.3 : 0.9 }}
            />
          </button>
        </div>
      )}

      {showCopiedToast && (
        <div className="copied-toast">
          Copied to clipboard
        </div>
      )}
    </div>
  );
}
