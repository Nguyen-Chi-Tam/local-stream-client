import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, X, Music, Video, Image, Pause, Home } from 'lucide-react';

import appIcon from '../../public/lsclient.png';
import defaultArt from '/default-art.png';
import { fetchMediaItemsCached, getCachedMediaItems } from '../functions/mediaApiCache.js';
import { getMediaType, pickThumbnailUrl, pickTitle, pickArtist } from '../functions/mediaUtils.js';
import { applyGlass, removeGlass, DEFAULT_SWITCHER_CONFIG } from '../lib/liquidGlass.js';
import DynamicIslandWaveform from './DynamicIslandWaveform.jsx';
import MarqueeText from './MarqueeText.jsx';

const NAV_ITEMS = [
  { id: 'music', label: 'Music', path: '/media', icon: Music },
  { id: 'video', label: 'Video', path: '/media/video', icon: Video },
  { id: 'photo', label: 'Photo', path: '/media/photo', icon: Image },
];

const MOBILE_MENU_ITEMS = [
  { id: 'music', label: 'Music', path: '/media', icon: Music, type: 'nav' },
  { id: 'video', label: 'Video', path: '/media/video', icon: Video, type: 'nav' },
  { id: 'photo', label: 'Photo', path: '/media/photo', icon: Image, type: 'nav' },
];

export default function Header({
  title,
  serverUrl,
  activeSection,
  onNavigate,
  onChangeServer,
  reloadNonce,
  isActivePage = true,
  playbackSnapshot = null,
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [counts, setCounts] = useState({ music: null, video: null, photo: null });
  const [mobileHighlightIdx, setMobileHighlightIdx] = useState(-1);
  const menuRef = useRef(null);
  const menuDropdownRef = useRef(null);
  const mobileIndicatorRef = useRef(null);
  const mobileItemsRef = useRef([]);
  const mobileMenuBtnRef = useRef(null);
  const menuPointerHandledRef = useRef(false);

  // Desktop Liquid Glass Switcher refs
  const navWrapRef = useRef(null);
  const navInnerRef = useRef(null);
  const navGlowRef = useRef(null);
  const indicatorRef = useRef(null);
  const itemsRef = useRef([]);

  const activeIdx = Math.max(
    0,
    NAV_ITEMS.findIndex((it) => it.id === activeSection)
  );

  // ── Media count fetching ───────────────────────────────────────
  useEffect(() => {
    if (!serverUrl) {
      setCounts({ music: null, video: null, photo: null });
      return;
    }

    let cancelled = false;

    const processItems = (items) => {
      if (!Array.isArray(items)) return;
      let music = 0;
      let video = 0;
      let photo = 0;

      for (const item of items) {
        const type = getMediaType(item);
        if (type === 'AUDIO') music++;
        else if (type === 'VIDEO') video++;
        else if (type === 'IMAGE') photo++;
      }

      if (!cancelled) {
        setCounts({ music, video, photo });
      }
    };

    const cached = getCachedMediaItems(serverUrl);
    if (cached) {
      processItems(cached);
    }

    fetchMediaItemsCached(serverUrl)
      .then((items) => {
        if (!cancelled) {
          processItems(items);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [serverUrl, reloadNonce]);

  let sectionKey = activeSection;
  if (!sectionKey && title) {
    const lower = title.toLowerCase();
    if (lower.includes('music')) sectionKey = 'music';
    else if (lower.includes('video')) sectionKey = 'video';
    else if (lower.includes('photo')) sectionKey = 'photo';
  }
  const currentCount = counts[sectionKey];
  const displayTitle =
    title && currentCount !== null && currentCount !== undefined
      ? /\s*\(\d+\)$/.test(title)
        ? title.replace(/\s*\(\d+\)$/, ` (${currentCount})`)
        : `${title} (${currentCount})`
      : title;

  const playbackTime = Number(playbackSnapshot?.currentTime) || 0;
  const formatPlaybackTime = (seconds) => {
    const value = Math.max(0, Math.floor(seconds));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  };
  const showPlaybackInMenu =
    activeSection !== playbackSnapshot?.type &&
    (playbackSnapshot?.type === 'music' || playbackSnapshot?.type === 'video') &&
    playbackSnapshot.item;
  const playbackArtUrl = showPlaybackInMenu
    ? pickThumbnailUrl(serverUrl, playbackSnapshot.item)
    : '';
  const playbackArtist = playbackSnapshot?.type === 'music'
    ? pickArtist(playbackSnapshot.item)
    : '';

  // ── Desktop Liquid Glass Switcher Mechanics ───────────────────────────
  const navRect = useCallback(() => {
    return navInnerRef.current ? navInnerRef.current.getBoundingClientRect() : null;
  }, []);

  const toLocalX = useCallback(
    (clientX) => {
      const nr = navRect();
      if (!nr || !navInnerRef.current) return 0;
      const sx = nr.width > 0 ? navInnerRef.current.clientWidth / nr.width : 1;
      return (clientX - nr.left) * sx;
    },
    [navRect]
  );

  const itemMetrics = useCallback(
    (i) => {
      const nr = navRect();
      const btn = itemsRef.current[i];
      if (!nr || !btn || !navInnerRef.current) return { left: 0, width: 0, center: 0 };
      const ir = btn.getBoundingClientRect();
      const sx = nr.width > 0 ? navInnerRef.current.clientWidth / nr.width : 1;
      const left = (ir.left - nr.left) * sx;
      const width = ir.width * sx;
      return { left, width, center: left + width / 2 };
    },
    [navRect]
  );

  const nearestIndex = useCallback(
    (localX) => {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < NAV_ITEMS.length; i++) {
        const d = Math.abs(localX - itemMetrics(i).center);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
    [itemMetrics]
  );

  const setIndicator = useCallback((left, width, animate = true) => {
    const indicator = indicatorRef.current;
    if (!indicator) return;
    if (!animate) {
      const old = indicator.style.transition;
      indicator.style.transition = 'none';
      indicator.style.left = `${left}px`;
      indicator.style.width = `${width}px`;
      // eslint-disable-next-line no-unused-expressions
      indicator.offsetWidth;
      indicator.style.transition = old;
      return;
    }
    indicator.style.left = `${left}px`;
    indicator.style.width = `${width}px`;
  }, []);

  const snapToIndex = useCallback(
    (i, animate = true) => {
      const m = itemMetrics(i);
      if (m.width > 0) {
        setIndicator(m.left, m.width, animate);
      }
    },
    [itemMetrics, setIndicator]
  );

  const setGlow = useCallback(
    (clientX, clientY, alpha) => {
      const nav = navInnerRef.current;
      const nr = navRect();
      if (!nav || !nr) return;
      const lx = toLocalX(clientX);
      nav.style.setProperty('--gx', `${lx}px`);
      nav.style.setProperty('--gy', `${clientY - nr.top}px`);
      nav.style.setProperty('--ga', String(alpha));
    },
    [navRect, toLocalX]
  );

  // Sync indicator on active section change and window resize
  useEffect(() => {
    if (!isActivePage) return undefined;

    let frameId = 0;
    let attempts = 0;

    const syncIndicator = () => {
      const activeButton = itemsRef.current[activeIdx];
      if (activeButton && activeButton.getBoundingClientRect().width > 0) {
        snapToIndex(activeIdx, true);
        return;
      }

      if (attempts < 10) {
        attempts += 1;
        frameId = requestAnimationFrame(syncIndicator);
      }
    };

    frameId = requestAnimationFrame(syncIndicator);

    const handleResize = () => snapToIndex(activeIdx, false);
    window.addEventListener('resize', handleResize);
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
    };
  }, [activeIdx, isActivePage, snapToIndex]);

  // Initial indicator positioning and Liquid Glass attachment
  useEffect(() => {
    if (!isActivePage) return undefined;

    const indicator = indicatorRef.current;
    if (indicator) {
      snapToIndex(activeIdx, false);
      applyGlass(indicator, DEFAULT_SWITCHER_CONFIG);
    }
    const mobileBtn = mobileMenuBtnRef.current;
    if (mobileBtn) {
      applyGlass(mobileBtn, DEFAULT_SWITCHER_CONFIG);
    }
    return () => {
      if (indicator) removeGlass(indicator);
      if (mobileBtn) removeGlass(mobileBtn);
    };
  }, [activeIdx, isActivePage, snapToIndex]);

  // Drag and Pointer interaction for desktop navbar
  const pointerStateRef = useRef({
    pointerId: null,
    dragMode: false,
    targetIndex: activeIdx,
    pressX: 0,
    pressY: 0,
    pressWidth: 0,
    finishTimer: null,
  });

  const handlePointerDown = (idx, e) => {
    if (!e.isPrimary || e.button !== 0) return;
    e.preventDefault();

    const p = pointerStateRef.current;
    if (p.pointerId !== null) return;
    p.pointerId = e.pointerId;
    p.dragMode = false;
    p.targetIndex = idx;
    p.pressX = e.clientX;
    p.pressY = e.clientY;
    p.pressWidth = itemMetrics(idx).width;

    clearTimeout(p.finishTimer);
    const indicator = indicatorRef.current;
    const navWrap = navWrapRef.current;
    if (indicator) {
      indicator.classList.remove('pressing', 'sliding');
      // Force reflow so the animation restarts cleanly
      // eslint-disable-next-line no-unused-expressions
      indicator.offsetWidth;
      indicator.classList.add('interacting', 'pressing', 'sliding');
    }
    if (navWrap) navWrap.classList.add('engaged');
    setGlow(e.clientX, e.clientY, 0.24);
    // Immediately slide indicator toward the clicked tab
    snapToIndex(idx, true);

    const onPointerMove = (moveEvent) => {
      if (moveEvent.pointerId !== p.pointerId) return;
      const dx = Math.abs(moveEvent.clientX - p.pressX);
      const dy = Math.abs(moveEvent.clientY - p.pressY);
      const DRAG_THRESHOLD = 5;

      if (!p.dragMode && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
        p.dragMode = true;
        if (navInnerRef.current) navInnerRef.current.classList.add('dragging');
      }

      if (p.dragMode) {
        setGlow(moveEvent.clientX, moveEvent.clientY, 0.2);
        const localX = toLocalX(moveEvent.clientX);
        const w = p.pressWidth || itemMetrics(activeIdx).width;
        const OVERSHOOT = 16;
        const navEl = navInnerRef.current;
        const maxLeft = navEl ? navEl.clientWidth - w + OVERSHOOT : 300;
        let left = localX - w / 2;
        left = Math.min(maxLeft, Math.max(-OVERSHOOT, left));
        if (indicatorRef.current) {
          indicatorRef.current.style.left = `${left}px`;
          indicatorRef.current.style.width = `${w}px`;
        }
        p.targetIndex = nearestIndex(localX);
      } else {
        setGlow(moveEvent.clientX, moveEvent.clientY, 0.22);
      }
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };

    const finishSelection = () => {
      if (navInnerRef.current) navInnerRef.current.classList.remove('dragging');
      const indicator = indicatorRef.current;
      if (indicator) {
        indicator.classList.remove('pressing');
        indicator.classList.add('sliding');
      }
      snapToIndex(p.targetIndex, true);
      if (NAV_ITEMS[p.targetIndex] && NAV_ITEMS[p.targetIndex].id !== activeSection) {
        onNavigate(NAV_ITEMS[p.targetIndex].path);
      }
      p.finishTimer = setTimeout(() => {
        if (indicatorRef.current) {
          indicatorRef.current.classList.remove('interacting', 'sliding');
        }
        if (navWrapRef.current) navWrapRef.current.classList.remove('engaged');
        if (navInnerRef.current) navInnerRef.current.style.setProperty('--ga', '0');
      }, 450);
    };

    const onPointerUp = (upEvent) => {
      if (upEvent.pointerId !== p.pointerId) return;
      cleanup();
      finishSelection();
      p.pointerId = null;
      p.dragMode = false;
    };

    const onPointerCancel = (cancelEvent) => {
      if (cancelEvent.pointerId !== p.pointerId) return;
      cleanup();
      if (navInnerRef.current) navInnerRef.current.classList.remove('dragging');
      snapToIndex(activeIdx, true);
      p.finishTimer = setTimeout(() => {
        if (indicatorRef.current) indicatorRef.current.classList.remove('interacting', 'pressing', 'sliding');
        if (navWrapRef.current) navWrapRef.current.classList.remove('engaged');
        if (navInnerRef.current) navInnerRef.current.style.setProperty('--ga', '0');
      }, 350);
      p.pointerId = null;
      p.dragMode = false;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  };

  const handleNavMouseMove = (e) => {
    if (pointerStateRef.current.pointerId === null) {
      setGlow(e.clientX, e.clientY, 0.16);
    }
  };

  const handleNavMouseLeave = () => {
    if (pointerStateRef.current.pointerId === null && navInnerRef.current) {
      navInnerRef.current.style.setProperty('--ga', '0');
    }
  };

  // ── Mobile Liquid Glass Menu Dialog Mechanics ───────────────────────────
  const snapMobileIndicator = useCallback((i, animate = true) => {
    const indicator = mobileIndicatorRef.current;
    const btn = mobileItemsRef.current[i];
    const dropdown = menuDropdownRef.current;
    if (!indicator || !btn || !dropdown) return;

    const top = btn.offsetTop;
    const height = btn.offsetHeight;
    const left = btn.offsetLeft;
    const width = btn.offsetWidth;

    if (!animate) {
      const old = indicator.style.transition;
      indicator.style.transition = 'none';
      indicator.style.top = `${top}px`;
      indicator.style.height = `${height}px`;
      indicator.style.left = `${left}px`;
      indicator.style.width = `${width}px`;
      indicator.style.opacity = '1';
      // eslint-disable-next-line no-unused-expressions
      indicator.offsetHeight;
      indicator.style.transition = old;
      return;
    }

    indicator.style.top = `${top}px`;
    indicator.style.height = `${height}px`;
    indicator.style.left = `${left}px`;
    indicator.style.width = `${width}px`;
    indicator.style.opacity = '1';
  }, []);

  const getItemFromPoint = useCallback((clientX, clientY) => {
    for (let i = 0; i < MOBILE_MENU_ITEMS.length; i++) {
      const btn = mobileItemsRef.current[i];
      if (btn) {
        const r = btn.getBoundingClientRect();
        if (
          clientX >= r.left - 25 &&
          clientX <= r.right + 25 &&
          clientY >= r.top - 4 &&
          clientY <= r.bottom + 4
        ) {
          return i;
        }
      }
    }
    return -1;
  }, []);

  // Liquid Glass attachment for mobile indicator
  useEffect(() => {
    if (!isMenuOpen) return;

    const indicator = mobileIndicatorRef.current;

    const activeMobileIdx = MOBILE_MENU_ITEMS.findIndex((it) => it.id === activeSection);
    const initialIdx = activeMobileIdx !== -1 ? activeMobileIdx : 0;
    setMobileHighlightIdx(initialIdx);

    const timeoutId = setTimeout(() => {
      snapMobileIndicator(initialIdx, false);
    }, 16);

    if (indicator) {
      applyGlass(indicator, DEFAULT_SWITCHER_CONFIG);
    }

    return () => {
      clearTimeout(timeoutId);
      if (indicator) removeGlass(indicator);
    };
  }, [isMenuOpen, activeSection, snapMobileIndicator]);

  // Handle slide gesture from mobile menu button (tap and hold + slide)
  const handleMobileMenuPointerDown = (e) => {
    if (!e.isPrimary || e.button !== 0) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let hasDragged = false;
    let isHolding = false;
    let currentTargetIdx = -1;

    // Start a hold timer: if held for >160ms, open menu for sliding
    const holdTimer = setTimeout(() => {
      isHolding = true;
      setIsMenuOpen(true);
    }, 160);

    const onPointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const dist = Math.hypot(dx, dy);

      if (!hasDragged && dist > 6) {
        hasDragged = true;
        isHolding = true;
        clearTimeout(holdTimer);
        setIsMenuOpen(true);
        menuPointerHandledRef.current = true;
      }

      if (hasDragged || isHolding) {
        const idx = getItemFromPoint(moveEvent.clientX, moveEvent.clientY);
        currentTargetIdx = idx;
        if (idx !== -1) {
          setMobileHighlightIdx(idx);
          snapMobileIndicator(idx, true);
          if (mobileIndicatorRef.current) {
            mobileIndicatorRef.current.classList.add('interacting');
          }
        } else {
          if (mobileIndicatorRef.current) {
            mobileIndicatorRef.current.classList.remove('interacting');
          }
        }
      }
    };

    const cleanup = () => {
      clearTimeout(holdTimer);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };

    const onPointerUp = (upEvent) => {
      cleanup();

      if (mobileIndicatorRef.current) {
        mobileIndicatorRef.current.classList.remove('interacting');
      }

      const dx = upEvent.clientX - startX;
      const dy = upEvent.clientY - startY;
      const dist = Math.hypot(dx, dy);

      if (hasDragged || (isHolding && dist > 4)) {
        menuPointerHandledRef.current = true;
        if (currentTargetIdx !== -1) {
          // Released on an option -> navigate & close
          const item = MOBILE_MENU_ITEMS[currentTargetIdx];
          if (item) {
            if (item.type === 'nav') {
              handleNavigate(item.path);
            } else if (item.type === 'action') {
              handleChangeServer();
            }
          }
        } else {
          // Released off options / off screen -> close dropdown
          setIsMenuOpen(false);
        }
        setTimeout(() => {
          menuPointerHandledRef.current = false;
        }, 150);
      } else {
        // Fast single tap: allow onClick to handle toggle cleanly
        menuPointerHandledRef.current = false;
      }
    };

    const onPointerCancel = () => {
      cleanup();
      if (mobileIndicatorRef.current) {
        mobileIndicatorRef.current.classList.remove('interacting');
      }
      if (hasDragged || isHolding) {
        setIsMenuOpen(false);
      }
      menuPointerHandledRef.current = false;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  };

  // Handle slide gesture inside dropdown
  const handleDropdownPointerDown = (e) => {
    if (!e.isPrimary || e.button !== 0) return;

    const initialIdx = getItemFromPoint(e.clientX, e.clientY);
    let currentTargetIdx = initialIdx !== -1 ? initialIdx : -1;
    let hasDragged = false;
    const startX = e.clientX;
    const startY = e.clientY;

    if (initialIdx !== -1) {
      setMobileHighlightIdx(initialIdx);
      snapMobileIndicator(initialIdx, true);
      if (mobileIndicatorRef.current) {
        mobileIndicatorRef.current.classList.add('interacting');
      }
    }

    const onPointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (Math.hypot(dx, dy) > 7) {
        hasDragged = true;
      }
      const targetIdx = getItemFromPoint(moveEvent.clientX, moveEvent.clientY);
      currentTargetIdx = targetIdx;
      if (targetIdx !== -1) {
        setMobileHighlightIdx(targetIdx);
        snapMobileIndicator(targetIdx, true);
        if (mobileIndicatorRef.current) {
          mobileIndicatorRef.current.classList.add('interacting');
        }
      } else {
        if (mobileIndicatorRef.current) {
          mobileIndicatorRef.current.classList.remove('interacting');
        }
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);

      if (mobileIndicatorRef.current) {
        mobileIndicatorRef.current.classList.remove('interacting');
      }

      if (currentTargetIdx !== -1) {
        const item = MOBILE_MENU_ITEMS[currentTargetIdx];
        if (item) {
          if (item.type === 'nav') {
            handleNavigate(item.path);
          } else if (item.type === 'action') {
            handleChangeServer();
          }
        }
      } else if (hasDragged) {
        setIsMenuOpen(false);
      }
    };

    const onPointerCancel = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      if (mobileIndicatorRef.current) {
        mobileIndicatorRef.current.classList.remove('interacting');
      }
      if (hasDragged) {
        setIsMenuOpen(false);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  };

  const handleItemMouseEnter = (idx) => {
    setMobileHighlightIdx(idx);
    snapMobileIndicator(idx, true);
  };

  const handleDropdownMouseLeave = () => {
    const defaultIdx = MOBILE_MENU_ITEMS.findIndex((it) => it.id === activeSection);
    setMobileHighlightIdx(defaultIdx);
    if (defaultIdx !== -1) {
      snapMobileIndicator(defaultIdx, true);
    }
  };

  // Close mobile dropdown when clicking or touching outside
  useEffect(() => {
    if (!isMenuOpen) return;

    function handleOutsideInteraction(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    }

    const timerId = setTimeout(() => {
      document.addEventListener('pointerdown', handleOutsideInteraction, true);
      document.addEventListener('touchstart', handleOutsideInteraction, true);
      document.addEventListener('mousedown', handleOutsideInteraction, true);
    }, 40);

    return () => {
      clearTimeout(timerId);
      document.removeEventListener('pointerdown', handleOutsideInteraction, true);
      document.removeEventListener('touchstart', handleOutsideInteraction, true);
      document.removeEventListener('mousedown', handleOutsideInteraction, true);
    };
  }, [isMenuOpen]);

  const toggleMenu = () => setIsMenuOpen((prev) => !prev);

  const handleNavigate = (path) => {
    onNavigate(path);
    setIsMenuOpen(false);
  };

  const handleChangeServer = () => {
    onChangeServer();
    setIsMenuOpen(false);
  };

  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <button
          type="button"
          className="app-icon-button"
          onClick={handleChangeServer}
          aria-label="Change server"
          title="Change server"
        >
          <img src={appIcon} alt="" className="app-icon" />
          <Home className="app-icon-home" size={22} aria-hidden="true" />
        </button>
        <div className="top-bar-title">
          <h1>{displayTitle}</h1>
          {serverUrl && (
            <a className="server-label" href={serverUrl} target="_blank" rel="noreferrer">
              <span className="connected-prefix">Connected to </span>{serverUrl}
            </a>
          )}
        </div>
      </div>

      {/* Desktop Liquid Glass Page Switcher Navbar */}
      <div className="top-bar-center desktop-only">
        <div
          className="ios26-nav lg-demo-target"
          data-radius="999"
          ref={navWrapRef}
          role="tablist"
          aria-label="Media sections"
        >
          <div
            className="ios26-nav-inner"
            ref={navInnerRef}
            onMouseMove={handleNavMouseMove}
            onMouseLeave={handleNavMouseLeave}
          >
            <div className="nav-glow" ref={navGlowRef} id="navGlow" />
            <div className="tab-indicator" ref={indicatorRef} id="tabIndicator" />
            {NAV_ITEMS.map((item, idx) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              const isPlaybackNav =
                (item.id === 'music' || item.id === 'video') &&
                activeSection !== item.id &&
                playbackSnapshot?.type === item.id &&
                playbackSnapshot.item;
              return (
                <button
                  key={item.id}
                  ref={(el) => (itemsRef.current[idx] = el)}
                  className={`ios-item ${isActive ? 'active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  style={{ touchAction: 'none' }}
                  onPointerDown={(e) => handlePointerDown(idx, e)}
                  onClick={() => handleNavigate(item.path)}
                >
                  {isPlaybackNav ? (
                    <>
                      <Icon className="ios-icon" size={17} />
                      <span className="ios-playback-time">
                        {formatPlaybackTime(playbackTime)}
                      </span>
                      <img
                        className="desktop-playback-art"
                        src={playbackArtUrl || defaultArt}
                        alt=""
                        aria-hidden="true"
                        onError={(event) => {
                          event.currentTarget.src = defaultArt;
                        }}
                      />
                      <span className="playback-island-tooltip" role="tooltip">
                        <span className="playback-island-tooltip-header">
                          <span className="playback-island-tooltip-type">
                            {playbackSnapshot.type === 'music' ? 'Music' : 'Video'}
                            {playbackArtist ? ` · ${playbackArtist}` : ''}
                          </span>
                          {playbackSnapshot.type === 'music' && (
                            <DynamicIslandWaveform
                              size="sm"
                              isPlaying={playbackSnapshot.isPlaying}
                              className="playback-tooltip-waveform"
                            />
                          )}
                        </span>
                        <span className="playback-island-tooltip-title">
                          {pickTitle(playbackSnapshot.item)}
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <Icon className="ios-icon" size={17} />
                      <span>{item.label}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="top-bar-right">
        <div className="mobile-only" ref={menuRef}>
          <button
            ref={mobileMenuBtnRef}
            className={`menu-button liquid-glass-btn lg-demo-target${showPlaybackInMenu ? ' playback-active' : ''}`}
            data-radius="999"
            style={{ touchAction: 'none' }}
            onPointerDown={handleMobileMenuPointerDown}
            onClick={(e) => {
              if (menuPointerHandledRef.current) {
                e.preventDefault();
                return;
              }
              toggleMenu();
            }}
            aria-label="Toggle menu"
            aria-expanded={isMenuOpen}
          >
            {showPlaybackInMenu && (
              <>
                <img
                  className="mobile-playback-art"
                  src={playbackArtUrl || defaultArt}
                  alt=""
                  aria-hidden="true"
                  onError={(event) => {
                    event.currentTarget.src = defaultArt;
                  }}
                />
                {playbackSnapshot.isPlaying ? (
                  <span className="ios-playback-time">{formatPlaybackTime(playbackTime)}</span>
                ) : (
                  <Pause className="mobile-playback-paused" size={15} fill="currentColor" />
                )}
              </>
            )}
            {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          {isMenuOpen && (
            <div
              ref={menuDropdownRef}
              className="menu-dropdown"
              style={{ touchAction: 'none' }}
              onPointerDown={handleDropdownPointerDown}
              onMouseLeave={handleDropdownMouseLeave}
            >
              <div className="menu-indicator" ref={mobileIndicatorRef} />
              {MOBILE_MENU_ITEMS.slice(0, 3).map((item, idx) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                const isHighlighted = mobileHighlightIdx === idx;
                const isPlaybackItem =
                  activeSection !== item.id &&
                  (item.id === 'music' || item.id === 'video') &&
                  playbackSnapshot?.type === item.id &&
                  playbackSnapshot.item;

                let displayText = item.label;
                if (isPlaybackItem) {
                  const title = pickTitle(playbackSnapshot.item);
                  const artist = pickArtist(playbackSnapshot.item);
                  const hasValidArtist = artist && !/^unknown( artist)?$/i.test(artist.trim());
                  if (title) {
                    displayText = hasValidArtist
                      ? `${item.label} \u2022 ${title} \u2022 ${artist}`
                      : `${item.label} \u2022 ${title}`;
                  }
                }

                return (
                  <button
                    key={item.id}
                    ref={(el) => (mobileItemsRef.current[idx] = el)}
                    className={`menu-item ${isActive ? 'active' : ''} ${isHighlighted ? 'highlighted' : ''}`}
                    type="button"
                    onClick={() => handleNavigate(item.path)}
                    onMouseEnter={() => handleItemMouseEnter(idx)}
                  >
                    <Icon size={18} style={{ flexShrink: 0 }} />
                    <MarqueeText
                      text={displayText}
                      className="menu-item-text"
                      enabled={isPlaybackItem}
                    />
                    {isPlaybackItem && (
                      <DynamicIslandWaveform
                        size="md"
                        isPlaying={playbackSnapshot.isPlaying}
                        className="menu-item-waveform"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
