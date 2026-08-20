import React, { useState, useEffect, useRef } from 'react';
import {
  ListPlus,
  ListX,
  CornerUpLeft,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FolderCheck,
  FolderX,
  Repeat,
  Shuffle,
  Gauge,
  Scaling,
  Trash2,
  X,
} from 'lucide-react';
import { subscribeQueueToast } from '../functions/queueService.js';
import { pickTitle } from '../functions/mediaUtils.js';

export default function QueueToast() {
  const [toast, setToast] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const timerRef = useRef(null);
  const exitTimerRef = useRef(null);
  const touchStartRef = useRef(null);

  const startDismissTimer = (delay = 2500) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      handleClose();
    }, delay);
  };

  useEffect(() => {
    const unsubscribe = subscribeQueueToast((data) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);

      setToast(data);
      setIsExiting(false);
      setDragOffset({ x: 0, y: 0 });
      setIsDragging(false);
      setIsVisible(true);

      startDismissTimer(2500);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, []);

  const handleClose = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsExiting(true);
    exitTimerRef.current = setTimeout(() => {
      setIsVisible(false);
      setIsExiting(false);
      setDragOffset({ x: 0, y: 0 });
      setIsDragging(false);
    }, 300);
  };

  const handleTouchStart = (e) => {
    e.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
    setIsDragging(true);
  };

  const handleTouchMove = (e) => {
    e.stopPropagation();
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;

    // Apply drag offset with vertical resistance for downward dragging
    const clampedY = dy > 0 ? dy * 0.35 : dy;
    setDragOffset({ x: dx, y: clampedY });
  };

  const handleTouchEnd = (e) => {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    if (!touchStartRef.current) return;
    setIsDragging(false);

    const { x: dx, y: dy, time: startTime } = touchStartRef.current;
    const currentDx = dragOffset.x;
    const currentDy = dragOffset.y;
    const elapsed = Date.now() - startTime;
    const dist = Math.hypot(currentDx, currentDy);

    // Dismiss threshold: swiped up (-y), swiped left/right (+/-x), or fast flick
    const isSwipeUp = currentDy < -25;
    const isSwipeHorizontal = Math.abs(currentDx) > 35;
    const isFastFlick = dist > 15 && elapsed < 220;

    if (isSwipeUp || isSwipeHorizontal || isFastFlick) {
      handleClose();
    } else {
      // Snap back to center smoothly
      setDragOffset({ x: 0, y: 0 });
      startDismissTimer(2000);
    }

    touchStartRef.current = null;
  };

  if (!toast || !isVisible) return null;

  const title = toast.item ? pickTitle(toast.item) : null;
  const action = toast.action || 'add';

  const renderIcon = () => {
    if (action === 'clear') return <Trash2 size={16} />;
    if (action === 'remove') return <ListX size={16} />;
    if (action === 'start') return <CornerUpLeft size={16} />;
    if (action === 'sort') return <ArrowUpDown size={16} />;
    if (action === 'sort_order') return toast.isSortReversed ? <ArrowDown size={16} /> : <ArrowUp size={16} />;
    if (action === 'group_folder') return toast.groupByFolder ? <FolderCheck size={16} /> : <FolderX size={16} />;
    if (action === 'repeat' || action === 'loop') return <Repeat size={16} />;
    if (action === 'shuffle') return <Shuffle size={16} />;
    if (action === 'speed') return <Gauge size={16} />;
    if (action === 'scaling') return <Scaling size={16} />;
    return <ListPlus size={16} />;
  };

  const getIconClass = () => {
    if (action === 'remove' || action === 'clear') return 'queue-toast-icon-remove';
    if (action === 'sort' || action === 'sort_order') return 'queue-toast-icon-sort';
    if (action === 'group_folder') return 'queue-toast-icon-folder';
    if (action === 'repeat' || action === 'loop' || action === 'shuffle' || action === 'speed' || action === 'scaling') return 'queue-toast-icon-player';
    return 'queue-toast-icon-add';
  };

  const isOffsetActive = dragOffset.x !== 0 || dragOffset.y !== 0;
  const dragDistance = Math.hypot(dragOffset.x, dragOffset.y);
  const dragOpacity = Math.max(0.1, 1 - dragDistance / 160);

  const containerStyle = {
    ...(isOffsetActive
      ? {
          transform: `translate(calc(-50% + ${dragOffset.x}px), ${dragOffset.y}px)`,
          opacity: dragOpacity,
          transition: isDragging
            ? 'none'
            : 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease',
        }
      : {}),
  };

  const stopEvent = (e) => {
    e.stopPropagation();
  };

  return (
    <div
      className={`queue-toast-container${isExiting ? ' queue-toast-exiting' : ''}${isDragging ? ' is-swiping' : ''}`}
      style={containerStyle}
      onClick={stopEvent}
      onMouseDown={stopEvent}
      onMouseUp={stopEvent}
      onPointerDown={stopEvent}
      onPointerUp={stopEvent}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div className="queue-toast-content">
        <div className={`queue-toast-icon ${getIconClass()}`}>
          {renderIcon()}
        </div>
        <div className="queue-toast-text">
          <span className="queue-toast-badge">{toast.message}</span>
          {title && <span className="queue-toast-title" title={title}>{title}</span>}
        </div>
        <button
          type="button"
          className="queue-toast-close"
          onClick={(e) => {
            e.stopPropagation();
            if (e.cancelable) e.preventDefault();
            handleClose();
          }}
          onMouseDown={stopEvent}
          onMouseUp={stopEvent}
          onTouchStart={stopEvent}
          onTouchEnd={(e) => {
            e.stopPropagation();
            if (e.cancelable) e.preventDefault();
            handleClose();
          }}
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
