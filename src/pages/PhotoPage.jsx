import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Folder, ChevronUp, ChevronDown, ChevronLeft, Delete, X, ArrowUp, ArrowDown, ArrowBigUp, RefreshCw, ArrowDownToLine, Check, Square, CheckSquare, SquareDashed, Search } from 'lucide-react';
import JSZip from 'jszip';

import { clearMediaCache, fetchMediaItemsCached, getMediaEndpoint } from '../functions/mediaApiCache.js';
import Header from '../components/Header.jsx';
import PhotoViewPage from './PhotoViewPage.jsx';
import { SkeletonPhotoCard } from '../components/Skeleton.jsx';
import PhotoItem from '../components/PhotoItem.jsx';
import { showToast } from '../functions/queueService.js';
import { NativeSelect, NativeSelectOption } from '../components/ui/native-select.jsx';
import {
  getItemId,
  pickTitle,
  pickDateValue,
  pickThumbnailUrl,
  pickSourceUrl,
  filterItems,
  sortItems,
  getMediaType,
  pickFolderName,
} from '../functions/mediaUtils.js';

const STORAGE_KEY = 'localstream_server_url';
const SETTINGS_KEY = 'localstream_photo_settings';

const isElectron = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);

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

function pickPhotoSourceUrl(serverUrl, item) {
  const id = getItemId(item);
  const base = (serverUrl || '').replace(/\/$/, '');

  // Image playback should use the canonical stream endpoint.
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

function getPhotoSelectionKey(item) {
  return String(
    getItemId(item) ??
      item?.__index ??
      item?.path ??
      item?.filePath ??
      item?.filepath ??
      item?.fullPath ??
      item?.location ??
      item?.url ??
      item?.streamUrl ??
      item?.fileName ??
      item?.filename ??
      pickTitle(item)
  );
}

async function downloadPhotoItem(serverUrl, item) {
  const sourceUrl = pickPhotoSourceUrl(serverUrl, item) || pickThumbnailUrl(serverUrl, item);
  if (!sourceUrl) return;

  const filename = buildPhotoFilename(item, sourceUrl);

  try {
    const response = await fetch(sourceUrl, { mode: 'cors' });
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
    link.href = sourceUrl;
    link.download = filename;
    link.target = '_blank';
    link.rel = 'noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

/**
 * Shared, lazily-created IntersectionObserver for all photo cards on the page.
 * Bidirectional: fires on both enter AND leave so images can be unloaded when
 * scrolled far away, freeing memory, and reloaded on scroll-back.
 * A debounce on the leave callback prevents flicker during slow scrolling.
 */
let _sharedObserver = null;
const _callbackMap = new WeakMap();   // el → { onEnter, onLeave }
const _unloadTimers = new WeakMap();  // el → timeoutId

// How long (ms) a card must stay out of the pre-load zone before its image unloads.
const UNLOAD_DEBOUNCE_MS = 600;

function getSharedObserver() {
  if (!_sharedObserver) {
    _sharedObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const cbs = _callbackMap.get(entry.target);
          if (!cbs) return;

          if (entry.isIntersecting) {
            // Cancel any pending unload and signal load
            const t = _unloadTimers.get(entry.target);
            if (t) { clearTimeout(t); _unloadTimers.delete(entry.target); }
            cbs.onEnter();
          } else {
            // Debounce unload — don't thrash if user pauses near the boundary
            if (_unloadTimers.has(entry.target)) return;
            const t = setTimeout(() => {
              _unloadTimers.delete(entry.target);
              cbs.onLeave();
            }, UNLOAD_DEBOUNCE_MS);
            _unloadTimers.set(entry.target, t);
          }
        });
      },
      // Load images 500px before they enter the viewport; unload when they are
      // more than 500px beyond the edge — gives a comfortable scroll buffer.
      { rootMargin: '500px' }
    );
  }
  return _sharedObserver;
}





export default function PhotoPage({
  serverUrl,
  onChangeServer,
  onNavigate,
  isViewOpen,
  isActivePage = true,
  playbackSnapshot,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [viewContext, setViewContext] = useState(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [currentNavIndex, setCurrentNavIndex] = useState(-1);
  const [downloadProgress, setDownloadProgress] = useState(null); // { current, total } or null
  const zipTaskRef = useRef(null);

  // Sync navigation index when selection groups change
  useEffect(() => {
    setCurrentNavIndex((prev) => {
      if (prev < 0) return prev;
      // selectionGroups isn't available yet on first render, so guard
      return prev;
    });
  }, [selectedPhotoIds.length]);

  const searchInputRef = useRef(null);
  const searchHistoryAddedRef = useRef(false);
  const selectionHistoryAddedRef = useRef(false);
  const photoListRef = useRef(null);
  const lastIncrementTimeRef = useRef(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [sortKey, setSortKey] = useState(() => loadSettings().sortKey ?? 'date');
  const [isSortReversed, setIsSortReversed] = useState(() => loadSettings().isSortReversed ?? false);
  const [groupByFolder, setGroupByFolder] = useState(() => loadSettings().groupByFolder ?? true);
  const [hiddenFolders, setHiddenFolders] = useState(() => loadSettings().hiddenFolders ?? []);
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

  const [renderLimit, setRenderLimit] = useState(80);
  // thumbLimit gates actual image loading independently from DOM renderLimit.
  // Prevents bursting dozens of simultaneous HTTP requests when jumping to bottom.
  const [thumbLimit, setThumbLimit] = useState(80);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const handleReload = useCallback(() => {
    if (!serverUrl) return;
    clearMediaCache(serverUrl);
    setReloadNonce((value) => value + 1);
  }, [serverUrl]);

  useEffect(() => {
    setRenderLimit(80);
    setThumbLimit(80);
  }, [searchQuery, sortKey, groupByFolder]);

  useEffect(() => {
    function handleScroll() {
      const container = photoListRef.current;
      if (!container) return;
      const scrollHeight = container.scrollHeight;
      const scrollTop = container.scrollTop;
      const clientHeight = container.clientHeight;
      
      if (scrollHeight - scrollTop - clientHeight < 1000) {
        const now = Date.now();
        if (now - lastIncrementTimeRef.current > 300) {
          lastIncrementTimeRef.current = now;
          setRenderLimit(prev => prev + 40);
          setThumbLimit(prev => prev + 40);
        }
      }

      setShowScrollTop(scrollTop > 400);
      setShowScrollBottom(scrollHeight - scrollTop - clientHeight > 400);
    }
    const container = photoListRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [items, loading]);



  const hiddenFolderSet = useMemo(() => new Set(hiddenFolders || []), [hiddenFolders]);


  const pageTitle = 'My Photos';
  const emptyText = 'No photos found on this server.';

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
          .filter((item) => getMediaType(item) === 'IMAGE');

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

  const selectedPhotoSet = useMemo(() => new Set(selectedPhotoIds), [selectedPhotoIds]);
  const selectedPhotoMap = useMemo(() => {
    const map = new Map();
    items.forEach((item) => {
      map.set(getPhotoSelectionKey(item), item);
    });
    return map;
  }, [items]);
  const selectedPhotos = useMemo(
    () => selectedPhotoIds.map((id) => selectedPhotoMap.get(id)).filter(Boolean),
    [selectedPhotoIds, selectedPhotoMap]
  );

  useEffect(() => {
    return () => {
      if (zipTaskRef.current) {
        zipTaskRef.current.cancelled = true;
        zipTaskRef.current.abortController?.abort();
      }
    };
  }, []);

  useEffect(() => {
    setSelectedPhotoIds((current) => current.filter((id) => selectedPhotoMap.has(id)));
  }, [selectedPhotoMap]);

  const togglePhotoSelection = useCallback((selectionKey) => {
    setSelectedPhotoIds((current) => {
      if (current.includes(selectionKey)) {
        return current.filter((id) => id !== selectionKey);
      }
      return [...current, selectionKey];
    });
  }, []);

  const clearPhotoSelection = useCallback(() => {
    if (downloadProgress) {
      if (zipTaskRef.current) {
        zipTaskRef.current.cancelled = true;
        zipTaskRef.current.abortController?.abort();
      }
      setDownloadProgress(null);
    }
    setSelectedPhotoIds([]);
    setIsSelectionMode(false);
  }, [downloadProgress]);

  // When selection mode is activated, push a history entry so the browser
  // back button (and Escape) properly exit selection mode.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isElectron) return;

    if (isSelectionMode && !selectionHistoryAddedRef.current) {
      const nextState = { ...(window.history.state || {}), __selection: true };
      window.history.pushState(nextState, '', window.location.pathname);
      selectionHistoryAddedRef.current = true;
      showToast({ action: 'selection', message: 'Selection mode' });
    }

    if (!isSelectionMode && selectionHistoryAddedRef.current) {
      selectionHistoryAddedRef.current = false;
    }
  }, [isSelectionMode]);

  useEffect(() => {
    if (isElectron) return;

    function handlePopState(e) {
      if (isViewOpen) return;

      // If we were in selection mode and the user pressed back, exit it
      const state = e ? e.state : window.history.state;
      if (isSelectionMode && !(state && state.__selection)) {
        clearPhotoSelection();
        return;
      }

      const hasQuery = !!String(searchQuery || '').trim();
      if (!hasQuery) return;

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
  }, [searchQuery, isViewOpen, isSelectionMode, clearPhotoSelection]);

  // Escape key exits selection mode
  useEffect(() => {
    if (!isSelectionMode) return;

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        clearPhotoSelection();
        // Also pop the history entry we pushed
        if (selectionHistoryAddedRef.current && !isElectron) {
          window.history.back();
          selectionHistoryAddedRef.current = false;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isSelectionMode, clearPhotoSelection]);

  const downloadSelectedPhotos = useCallback(async () => {
    if (!selectedPhotos.length || downloadProgress) return;

    if (selectedPhotos.length <= 10) {
      // Download individually for small selections
      for (const item of selectedPhotos) {
        await downloadPhotoItem(serverUrl, item);
      }
    } else {
      // Bundle into a zip for large selections
      const zipTask = { cancelled: false, abortController: null };
      zipTaskRef.current = zipTask;
      const zip = new JSZip();
      const total = selectedPhotos.length;
      setDownloadProgress({ current: 0, total });
      const isCancelled = () => zipTask.cancelled || zipTaskRef.current !== zipTask;

      // Track filenames to avoid collisions
      const usedNames = new Map();

      for (let i = 0; i < total; i++) {
        if (isCancelled()) {
          setDownloadProgress(null);
          return;
        }
        const item = selectedPhotos[i];
        const sourceUrl = pickPhotoSourceUrl(serverUrl, item) || pickThumbnailUrl(serverUrl, item);
        if (!sourceUrl) continue;

        let filename = buildPhotoFilename(item, sourceUrl);
        // Deduplicate filenames
        if (usedNames.has(filename)) {
          const count = usedNames.get(filename) + 1;
          usedNames.set(filename, count);
          const dot = filename.lastIndexOf('.');
          if (dot > 0) {
            filename = filename.slice(0, dot) + ` (${count})` + filename.slice(dot);
          } else {
            filename = filename + ` (${count})`;
          }
        } else {
          usedNames.set(filename, 0);
        }

        let abortController = null;
        try {
          abortController = new AbortController();
          zipTask.abortController = abortController;
          const response = await fetch(sourceUrl, { mode: 'cors', signal: abortController.signal });
          if (!response.ok) throw new Error('fetch failed');
          const blob = await response.blob();
          if (isCancelled()) {
            setDownloadProgress(null);
            return;
          }
          zip.file(filename, blob);
        } catch {
          // Skip failed items silently
        } finally {
          if (zipTask.abortController === abortController) {
            zipTask.abortController = null;
          }
        }

        if (isCancelled()) {
          setDownloadProgress(null);
          return;
        }
        setDownloadProgress({ current: i + 1, total });
      }

      if (isCancelled()) {
        setDownloadProgress(null);
        return;
      }

      try {
        const zipBlob = await zip.generateAsync({ type: 'blob' }, () => {
          if (isCancelled()) {
            throw new Error('Zip cancelled');
          }
        });
        if (isCancelled()) {
          setDownloadProgress(null);
          return;
        }
        const blobUrl = window.URL.createObjectURL(zipBlob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `photos_${selectedPhotos.length}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
      } catch {
        // ignore zip generation errors
      } finally {
        if (zipTaskRef.current === zipTask) {
          zipTaskRef.current = null;
        }
      }

      setDownloadProgress(null);
    }
  }, [downloadProgress, selectedPhotos, serverUrl]);


  // Sort first, then filter, then optionally group by folder
  const sortedItems = useMemo(
    () => sortItems(items, sortKey, isSortReversed),
    [items, sortKey, isSortReversed]
  );
  // Filter after sorting (for search) — applied before grouping so search works in grouped view
  const filtered = useMemo(() => filterItems(sortedItems, searchQuery), [sortedItems, searchQuery]);

  // Auto-expand renderLimit if the content doesn't overflow the container height
  // (prevents the layout from getting stuck when no scrollbar exists to trigger scroll events)
  // Must be placed AFTER `filtered` is defined.
  useEffect(() => {
    const container = photoListRef.current;
    if (!container || loading) return;

    const checkScrollHeight = () => {
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;

      if (scrollHeight > 0 && scrollHeight <= clientHeight && renderLimit < filtered.length) {
        setRenderLimit((prev) => prev + 40);
      }
    };

    const timer = setTimeout(checkScrollHeight, 300);
    return () => clearTimeout(timer);
  }, [renderLimit, filtered.length, loading, items]);
  const groupedItems = useMemo(() => {
    if (!groupByFolder) return null;
    const map = {};
    filtered.forEach((item) => {
      const folder = pickFolderName(item) || 'Other';
      if (!map[folder]) map[folder] = [];
      map[folder].push(item);
    });
    return map;
  }, [filtered, groupByFolder]);
  const groupKeys = useMemo(() => {
    if (!groupByFolder || !groupedItems) return [];
    const keys = Object.keys(groupedItems);
    if (sortKey === 'date') {
      // Sort folders by the latest date value of items inside (descending)
      const folderDates = {};
      keys.forEach((k) => {
        const items = groupedItems[k] || [];
        const maxDate = Math.max(...items.map((item) => (typeof pickDateValue === 'function' ? pickDateValue(item) : 0)), 0);
        folderDates[k] = maxDate;
      });

      return keys.sort((a, b) => folderDates[b] - folderDates[a]);
    } else {
      // Default: alphabetical
      return keys.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }
  }, [groupedItems, groupByFolder, sortKey]);

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

  const isAllFilteredSelected = useMemo(() => {
    if (filtered.length === 0) return false;
    return filtered.every((item) => selectedPhotoSet.has(getPhotoSelectionKey(item)));
  }, [filtered, selectedPhotoSet]);

  const toggleSelectAllFiltered = useCallback(() => {
    if (isAllFilteredSelected) {
      const filteredKeys = new Set(filtered.map((item) => getPhotoSelectionKey(item)));
      setSelectedPhotoIds((current) => current.filter((id) => !filteredKeys.has(id)));
    } else {
      setSelectedPhotoIds((current) => {
        const next = new Set(current);
        filtered.forEach((item) => next.add(getPhotoSelectionKey(item)));
        return Array.from(next);
      });
    }
  }, [filtered, isAllFilteredSelected]);

  const toggleFolderSelection = useCallback((groupKey, shouldSelectAll) => {
    const groupItems = groupedItems[groupKey] || [];
    const groupKeys = groupItems.map((item) => getPhotoSelectionKey(item));
    setSelectedPhotoIds((current) => {
      const next = new Set(current);
      if (shouldSelectAll) {
        groupKeys.forEach((key) => next.add(key));
      } else {
        groupKeys.forEach((key) => next.delete(key));
      }
      return Array.from(next);
    });
  }, [groupedItems]);

  const handleSelectAllToggle = useCallback(() => {
    if (!isSelectionMode) {
      setIsSelectionMode(true);
    } else {
      toggleSelectAllFiltered();
    }
  }, [isSelectionMode, toggleSelectAllFiltered]);

  function openPhotoOverlay(itemId, groupKey) {
    const list = groupKey ? groupedItems[groupKey] : filtered;
    setViewContext({ itemId, list });
    onNavigate('/media/photo/view');
  }

  function closePhotoOverlay() {
    setViewContext(null);
    onNavigate('/media/photo');
  }

  // Get all items in the exact visual layout order (grouped or flat)
  const allVisualItems = useMemo(() => {
    if (groupByFolder && groupedItems && groupKeys.length > 0) {
      const list = [];
      groupKeys.forEach((groupKey) => {
        const groupItems = groupedItems[groupKey] || [];
        groupItems.forEach((item) => {
          list.push({ item, groupKey });
        });
      });
      return list;
    } else {
      return filtered.map((item) => ({ item, groupKey: null }));
    }
  }, [groupByFolder, groupedItems, groupKeys, filtered]);

  // Selected items in visual layout order
  const visualSelectedItems = useMemo(() => {
    return allVisualItems.filter(({ item }) => {
      const selectionKey = getPhotoSelectionKey(item);
      return selectedPhotoSet.has(selectionKey);
    });
  }, [allVisualItems, selectedPhotoSet]);

  // Group consecutive selected items into runs so navigation jumps between
  // non-adjacent selection blocks rather than stepping through every single item.
  const selectionGroups = useMemo(() => {
    if (visualSelectedItems.length === 0) return [];
    const groups = [];
    let currentGroup = null;

    for (let i = 0; i < allVisualItems.length; i++) {
      const selKey = getPhotoSelectionKey(allVisualItems[i].item);
      if (selectedPhotoSet.has(selKey)) {
        if (!currentGroup) {
          currentGroup = { startVisualIndex: i, startItem: allVisualItems[i], count: 1 };
        } else {
          currentGroup.count++;
        }
      } else {
        if (currentGroup) {
          groups.push(currentGroup);
          currentGroup = null;
        }
      }
    }
    if (currentGroup) groups.push(currentGroup);
    return groups;
  }, [allVisualItems, selectedPhotoSet, visualSelectedItems.length]);

  // Scroll to the first item of a selection group
  const scrollToGroup = useCallback((groupIndex) => {
    const group = selectionGroups[groupIndex];
    if (!group) return;

    const target = group.startItem;
    const selectionKey = getPhotoSelectionKey(target.item);

    // 1. Expand the folder if hidden
    if (target.groupKey && hiddenFolderSet.has(target.groupKey)) {
      setHiddenFolders((prev) => prev.filter((k) => k !== target.groupKey));
    }

    // 2. Adjust renderLimit to make sure it is rendered in DOM
    if (group.startVisualIndex >= 0) {
      setRenderLimit((prev) => Math.max(prev, group.startVisualIndex + 60));
    }

    // 3. Scroll and highlight after DOM finishes updates
    setTimeout(() => {
      const el = document.getElementById(`photo-card-${selectionKey}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('nav-highlighted');
        setTimeout(() => {
          el.classList.remove('nav-highlighted');
        }, 1500);
      }
    }, 120);
  }, [selectionGroups, hiddenFolderSet]);

  const handleNavNext = useCallback(() => {
    if (selectionGroups.length === 0) return;
    setCurrentNavIndex((prev) => {
      const next = (prev + 1) % selectionGroups.length;
      scrollToGroup(next);
      return next;
    });
  }, [selectionGroups, scrollToGroup]);

  const handleNavPrev = useCallback(() => {
    if (selectionGroups.length === 0) return;
    setCurrentNavIndex((prev) => {
      const next = prev <= 0 ? selectionGroups.length - 1 : prev - 1;
      scrollToGroup(next);
      return next;
    });
  }, [selectionGroups, scrollToGroup]);

  return (
    <div className={"media-page-container" + (isSelectionMode ? " selection-mode-active" : "")}>
      <Header
        title={pageTitle}
        serverUrl={serverUrl}
        activeSection="photo"
        onNavigate={onNavigate}
        onChangeServer={onChangeServer}
        reloadNonce={reloadNonce}
        isActivePage={isActivePage}
        playbackSnapshot={playbackSnapshot}
      />

      <main className="page photo-page media-page-layout">
        <section className="media-list-column card full photo-player-card">
          {loading && <div className="info">Loading media from LocalStream...</div>}
          {error && !loading && (
            <div className="error">
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
                  placeholder="Search photos..."
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
              <label htmlFor="photo-sort-select" className="sort-label">
                Sort by
              </label>
              <NativeSelect
                id="photo-sort-select"
                aria-label="Sort media list"
                value={sortKey}
                onChange={(e) => {
                  const val = e.target.value || 'date';
                  setSortKey(val);
                  const labels = { date: 'Date', name: 'Name' };
                  const label = labels[val] || (val ? val.charAt(0).toUpperCase() + val.slice(1) : 'Date');
                  showToast({ action: 'sort', message: `Sort by: ${label}` });
                }}
              >
                <NativeSelectOption value="date">Date</NativeSelectOption>
                <NativeSelectOption value="name">Name</NativeSelectOption>
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
                className={
                  'icon-button sort-icon-button select-all-toggle' + 
                  (isSelectionMode ? ' selection-active' : '') +
                  (isSelectionMode && isAllFilteredSelected ? ' toggle-active' : '')
                }
                aria-label={
                  !isSelectionMode 
                    ? 'Enter selection mode' 
                    : isAllFilteredSelected 
                      ? 'Deselect all' 
                      : 'Select all'
                }
                title={
                  !isSelectionMode 
                    ? 'Enter selection mode' 
                    : isAllFilteredSelected 
                      ? 'Deselect all' 
                      : 'Select all'
                }
                onClick={handleSelectAllToggle}
                disabled={filtered.length === 0}
              >
                {!isSelectionMode ? (
                  <SquareDashed size={16} />
                ) : isAllFilteredSelected ? (
                  <CheckSquare size={16} />
                ) : (
                  <Square size={16} />
                )}
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


          <div className="music-list-shell">
            <div className="music-list" ref={photoListRef}>
              {loading && items.length === 0 ? (
                <div className="visual-grid" aria-label="Loading photos">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <SkeletonPhotoCard key={`loading-skel-${i}`} />
                  ))}
                </div>
              ) : (
                <>
                  {(() => {
                    let renderedCount = 0;
                    const itemsToRenderLimit = renderLimit;

                    if (groupByFolder) {
                      return (
                        <div className="visual-grid-grouped" aria-label="Photo gallery grouped by folder">
                          <div className="folder-header">
                            <div className="folder-header-left">
                              <span className="folder-name">All</span>
                            </div>
                            <div className="folder-header-actions">
                              <button
                                type="button"
                                className="secondary folder-hide-button"
                                aria-label={areAllFoldersHidden ? 'Show all folders' : 'Hide all folders'}
                                onClick={toggleAllFolders}
                              >
                                {areAllFoldersHidden ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>
                            </div>
                          </div>
                          {groupKeys.map((groupKey) => {
                            const groupItems = groupedItems[groupKey] || [];
                            const isQueued = groupKey === 'Queued';
                            const isHidden = !isQueued && hiddenFolderSet.has(groupKey);
                            const remainingLimit = Math.max(0, itemsToRenderLimit - renderedCount);
                            const visibleItems = isHidden ? [] : groupItems.slice(0, remainingLimit);
                            renderedCount += visibleItems.length;

                            return (
                              <React.Fragment key={groupKey}>
                                <div className="folder-header">
                                  <div className="folder-header-left">
                                    {(() => {
                                      const isAllInFolderSelected = groupItems.every((item) => selectedPhotoSet.has(getPhotoSelectionKey(item)));
                                      return (
                                        <label
                                          className={'folder-select-control' + (isAllInFolderSelected ? ' selected' : '')}
                                          onClick={(event) => event.stopPropagation()}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isAllInFolderSelected}
                                            onChange={() => toggleFolderSelection(groupKey, !isAllInFolderSelected)}
                                            aria-label={isAllInFolderSelected ? `Deselect folder ${groupKey}` : `Select folder ${groupKey}`}
                                          />
                                          <span className="photo-select-box" aria-hidden="true">
                                            {isAllInFolderSelected && <Check size={10} strokeWidth={3} />}
                                          </span>
                                        </label>
                                      );
                                    })()}
                                    <span className="folder-name">{groupKey} ({groupItems.length})</span>
                                  </div>
                                  {!isQueued && (
                                    <div className="folder-header-actions">
                                      <button
                                        type="button"
                                        className="secondary folder-hide-button"
                                        aria-label={isHidden ? 'Show photos in this folder' : 'Hide photos in this folder'}
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
                                    </div>
                                  )}
                                </div>
                                {!isHidden && visibleItems.length > 0 && (
                                  <div className="visual-grid">
                                    {visibleItems.map((item, idx) => {
                                      const key = String(getItemId(item) ?? item.__index ?? pickTitle(item));
                                      const itemId = getItemId(item);
                                      const selectionKey = getPhotoSelectionKey(item);
                                      return (
                                        <PhotoItem
                                          key={key}
                                          item={item}
                                          serverUrl={serverUrl}
                                          isSelected={selectedPhotoSet.has(selectionKey)}
                                          onToggleSelect={isSelectionMode ? togglePhotoSelection : undefined}
                                          canLoadImg={(renderedCount - visibleItems.length + idx) < thumbLimit}

                                          onClick={() => {
                                            if (isSelectionMode) {
                                              togglePhotoSelection(selectionKey);
                                            } else {
                                              openPhotoOverlay(itemId, groupKey);
                                            }
                                          }}
                                        />
                                      );
                                    })}
                                  </div>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </div>
                      );
                    } else {
                      const visibleItems = filtered.slice(0, itemsToRenderLimit);
                      return (
                        <div className="visual-grid" aria-label="Photo gallery">
                          {visibleItems.map((item, idx) => {
                            const key = String(getItemId(item) ?? item.__index ?? pickTitle(item));
                            const itemId = getItemId(item);
                            const selectionKey = getPhotoSelectionKey(item);
                            return (
                              <PhotoItem
                                key={key}
                                item={item}
                                serverUrl={serverUrl}
                                isSelected={selectedPhotoSet.has(selectionKey)}
                                onToggleSelect={isSelectionMode ? togglePhotoSelection : undefined}
                                canLoadImg={idx < thumbLimit}

                                onClick={() => {
                                  if (isSelectionMode) {
                                    togglePhotoSelection(selectionKey);
                                  } else {
                                    openPhotoOverlay(itemId, null);
                                  }
                                }}
                              />
                            );
                          })}
                        </div>
                      );
                    }
                  })()}
                  {renderLimit < filtered.length && (
                    <div className="visual-grid" style={{ marginTop: '1.5rem' }}>
                      {Array.from({ length: 4 }).map((_, i) => (
                        <SkeletonPhotoCard key={`skel-bottom-${i}`} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

        </section>
      </main>

      {isViewOpen && viewContext && (
        <PhotoViewPage
          serverUrl={serverUrl}
          initialPhotoId={viewContext.itemId}
          photoList={viewContext.list}
          onClose={closePhotoOverlay}
        />
      )}

      {!isViewOpen && isSelectionMode && (
        <div className="photo-selection-dialog" role="status" aria-live="polite">
          <div className="photo-selection-copy">
            {downloadProgress ? (
              <>
                <strong>{downloadProgress.current}/{downloadProgress.total}</strong>
                <span>zipping…</span>
              </>
            ) : (
              <>
                <strong>{selectedPhotos.length}</strong>
                <span>{selectedPhotos.length === 1 ? 'photo selected' : 'photos selected'}</span>
              </>
            )}
          </div>

          {selectedPhotos.length > 0 && !downloadProgress && (
            <div className="photo-selection-nav">
              <button
                type="button"
                className="icon-button photo-selection-nav-btn"
                onClick={handleNavPrev}
                aria-label="Previous selection group"
                title="Previous selection group"
                disabled={selectionGroups.length <= 1}
              >
                <ChevronUp size={16} strokeWidth={2.6} />
              </button>
              <button
                type="button"
                className="icon-button photo-selection-nav-btn"
                onClick={handleNavNext}
                aria-label="Next selection group"
                title="Next selection group"
                disabled={selectionGroups.length <= 1}
              >
                <ChevronDown size={16} strokeWidth={2.6} />
              </button>
            </div>
          )}

          <div className="photo-selection-actions">
            {selectedPhotos.length > 0 && (
              <button
                type="button"
                className="icon-button photo-selection-download-button"
                onClick={downloadSelectedPhotos}
                aria-label={selectedPhotos.length > 10 ? 'Download as zip' : 'Download selected photos'}
                title={selectedPhotos.length > 10 ? 'Download as zip' : 'Download selected photos'}
                disabled={!!downloadProgress}
              >
                <ArrowDownToLine size={16} />
              </button>
            )}
            <button
              type="button"
              className="icon-button photo-selection-close-button"
              onClick={clearPhotoSelection}
              aria-label={downloadProgress ? 'Stop zipping' : 'Clear selection'}
              title={downloadProgress ? 'Stop zipping' : 'Clear selection'}
            >
              <X size={16} strokeWidth={2.6} />
            </button>
          </div>
        </div>
      )}

      <div className={`scroll-fab-pill ${showScrollTop || showScrollBottom ? 'visible' : ''}`}>
        <button
          type="button"
          className={`scroll-fab-btn scroll-fab-top ${showScrollTop ? 'active' : ''}`}
          onClick={() => photoListRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Scroll to top"
          title="Scroll to top"
          disabled={!showScrollTop}
        >
          <ChevronUp size={20} strokeWidth={2.5} />
        </button>
        <div className="scroll-fab-divider" />
        <button
          type="button"
          className={`scroll-fab-btn scroll-fab-bottom ${showScrollBottom ? 'active' : ''}`}
          onClick={() => {
            const container = photoListRef.current;
            if (!container) return;
            // Expand both render AND thumb limit to all items
            setRenderLimit(filtered.length);
            setThumbLimit(filtered.length);
            // Then scroll after React has had a chance to rerender
            setTimeout(() => {
              container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
            }, 0);
          }}
          aria-label="Scroll to bottom"
          title="Scroll to bottom"
          disabled={!showScrollBottom}
        >
          <ChevronDown size={20} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
