import React, { useEffect, useMemo, useState } from 'react';
import { Folder, ChevronUp, ChevronDown, ArrowDownToLine, X } from 'lucide-react';
import { fetchMediaItemsCached, getMediaEndpoint } from './mediaApiCache.js';
import Header from './Header.jsx';
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
} from './mediaUtils.js';

const STORAGE_KEY = 'localstream_server_url';
const SETTINGS_KEY = 'localstream_photo_settings';

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.hiddenFolders)) parsed.hiddenFolders = [];
      return parsed;
    }
  } catch {}
  return { hiddenFolders: [] };
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

export default function PhotoPage({
  serverUrl,
  onChangeServer,
  onNavigate,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [selectedPhotoId, setSelectedPhotoId] = useState(null);
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState('');
  const [photoListForSlideshow, setPhotoListForSlideshow] = useState([]);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(-1);
  const [touchStartX, setTouchStartX] = useState(0);

  const [searchQuery, setSearchQuery] = useState(() => loadSettings().searchQuery ?? '');
  const [sortKey, setSortKey] = useState(() => loadSettings().sortKey ?? 'date');
  const [isSortReversed, setIsSortReversed] = useState(() => loadSettings().isSortReversed ?? false);
  const [groupByFolder, setGroupByFolder] = useState(() => loadSettings().groupByFolder ?? true);
  const [hiddenFolders, setHiddenFolders] = useState(() => loadSettings().hiddenFolders ?? []);
  // Persist settings whenever they change
  useEffect(() => { saveSettings({ sortKey }); }, [sortKey]);
  useEffect(() => { saveSettings({ isSortReversed }); }, [isSortReversed]);
  useEffect(() => { saveSettings({ groupByFolder }); }, [groupByFolder]);
  useEffect(() => { saveSettings({ hiddenFolders }); }, [hiddenFolders]);
  useEffect(() => { saveSettings({ searchQuery }); }, [searchQuery]);

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
  }, [serverUrl]);

  useEffect(() => {
    if (!serverUrl) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, serverUrl);
    } catch {
      // ignore
    }
  }, [serverUrl]);


  // Sort first, then optionally group by folder
  const sortedItems = useMemo(
    () => sortItems(items, sortKey, isSortReversed),
    [items, sortKey, isSortReversed]
  );
  const groupedItems = useMemo(() => {
    if (!groupByFolder) return null;
    const map = {};
    sortedItems.forEach((item) => {
      const folder = pickFolderName(item) || 'Other';
      if (!map[folder]) map[folder] = [];
      map[folder].push(item);
    });
    return map;
  }, [sortedItems, groupByFolder]);
  const groupKeys = useMemo(
    () =>
      groupByFolder && groupedItems
        ? Object.keys(groupedItems).sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: 'base' })
          )
        : [],
    [groupedItems, groupByFolder]
  );
  // Filter after grouping (for search)
  const filtered = useMemo(() => filterItems(sortedItems, searchQuery), [sortedItems, searchQuery]);

  // Handle keyboard navigation and touch swipe in slideshow
  useEffect(() => {
    function handleKeyDown(event) {
      if (selectedPhotoId == null) return;

      const key = event.key;

      if (key === 'Escape') {
        closePhotoOverlay();
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
    }

    if (selectedPhotoId != null) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [selectedPhotoId, currentPhotoIndex, photoListForSlideshow]);

  function goToPrevPhoto() {
    if (currentPhotoIndex > 0) {
      const prevItem = photoListForSlideshow[currentPhotoIndex - 1];
      if (prevItem) {
        const prevSourceUrl = pickPhotoSourceUrl(serverUrl, prevItem);
        const prevThumbUrl = pickThumbnailUrl(serverUrl, prevItem);
        setSelectedPhotoId(getItemId(prevItem));
        setSelectedPhotoUrl(prevSourceUrl || prevThumbUrl);
        setCurrentPhotoIndex(currentPhotoIndex - 1);
      }
    }
  }

  function goToNextPhoto() {
    if (currentPhotoIndex < photoListForSlideshow.length - 1) {
      const nextItem = photoListForSlideshow[currentPhotoIndex + 1];
      if (nextItem) {
        const nextSourceUrl = pickPhotoSourceUrl(serverUrl, nextItem);
        const nextThumbUrl = pickThumbnailUrl(serverUrl, nextItem);
        setSelectedPhotoId(getItemId(nextItem));
        setSelectedPhotoUrl(nextSourceUrl || nextThumbUrl);
        setCurrentPhotoIndex(currentPhotoIndex + 1);
      }
    }
  }

  function handleTouchStart(e) {
    setTouchStartX(e.touches[0].clientX);
  }

  function handleTouchEnd(e) {
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX - touchEndX;
    const minSwipeDistance = 50;

    if (Math.abs(diff) > minSwipeDistance) {
      if (diff > 0) {
        // Swiped left - go to next photo
        goToNextPhoto();
      } else {
        // Swiped right - go to previous photo
        goToPrevPhoto();
      }
    }
  }

  function openPhotoOverlay(itemId, sourceUrl, photoList = []) {
    setSelectedPhotoId(itemId);
    setSelectedPhotoUrl(sourceUrl);
    setPhotoListForSlideshow(photoList);
    const index = photoList.findIndex((item) => getItemId(item) === itemId);
    setCurrentPhotoIndex(index >= 0 ? index : 0);
  }

  function closePhotoOverlay() {
    setSelectedPhotoId(null);
    setSelectedPhotoUrl('');
    setPhotoListForSlideshow([]);
    setCurrentPhotoIndex(-1);
  }

  async function handleSaveCurrentPhoto() {
    if (selectedPhotoId == null || !selectedPhotoUrl) return;

    const selectedItem =
      photoListForSlideshow.find((item) => getItemId(item) === selectedPhotoId) || null;
    const filename = buildPhotoFilename(selectedItem || {}, selectedPhotoUrl);

    try {
      let response;
      try {
        response = await fetch(selectedPhotoUrl, { 
          mode: 'cors',
          targetAddressSpace: 'private'
        });
      } catch (err) {
        try {
          response = await fetch(selectedPhotoUrl, { 
            mode: 'cors',
            targetAddressSpace: 'local'
          });
        } catch (err2) {
          response = await fetch(selectedPhotoUrl, { 
            mode: 'cors'
          });
        }
      }
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
      // Fallback for environments that block blob downloads.
      const link = document.createElement('a');
      link.href = selectedPhotoUrl;
      link.download = filename;
      link.target = '_blank';
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  return (
    <>
      <Header
        title={pageTitle}
        serverUrl={serverUrl}
        activeSection="photo"
        onNavigate={onNavigate}
        onChangeServer={onChangeServer}
      />

      <main className="page">
        <section className="card full">
          {loading && <div className="info">Loading media from LocalStream...</div>}
          {error && !loading && <div className="error">{error}</div>}
          {!loading && !error && sortedItems.length === 0 && (
            <div className="info">{emptyText}</div>
          )}


          <div className="toolbar-row">
            <div className="search-row">
              <input
                type="search"
                placeholder="Search photos..."
                aria-label="Search media"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="sort-row">
              <label htmlFor="photo-sort-select" className="sort-label">
                Sort by
              </label>
              <select
                id="photo-sort-select"
                aria-label="Sort media list"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value || 'date')}
              >
                <option value="date">Date</option>
                <option value="name">Name</option>
              </select>
              <button
                type="button"
                className="icon-button sort-icon-button"
                aria-label="Reverse current order"
                onClick={() => setIsSortReversed((v) => !v)}
              >
                ⇅
              </button>
              <button
                type="button"
                className={
                  'icon-button sort-icon-button sort-toggle' + (groupByFolder ? ' toggle-active' : '')
                }
                aria-pressed={groupByFolder ? 'true' : 'false'}
                aria-label="Toggle grouping by folder"
                onClick={() => setGroupByFolder((v) => !v)}
              >
                <Folder size={16} />
              </button>
            </div>
          </div>


          {groupByFolder ? (
            <div className="visual-grid-grouped" aria-label="Photo gallery grouped by folder">
              {groupKeys.map((groupKey) => (
                <React.Fragment key={groupKey}>
                  <div className="folder-header">
                    <span className="folder-name">{groupKey}</span>
                    <button
                      type="button"
                      className="secondary folder-hide-button"
                      aria-label={
                        hiddenFolderSet.has(groupKey)
                          ? 'Show photos in this folder'
                          : 'Hide photos in this folder'
                      }
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
                      {hiddenFolderSet.has(groupKey) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                  {!hiddenFolderSet.has(groupKey) && (
                    <div className="visual-grid">
                      {groupedItems[groupKey].map((item) => {
                        const key = String(getItemId(item) ?? item.__index ?? pickTitle(item));
                        const itemId = getItemId(item);
                        const title = pickTitle(item);
                        const sourceUrl = pickPhotoSourceUrl(serverUrl, item);
                        const thumbUrl = pickThumbnailUrl(serverUrl, item);
                        return (
                          <article
                            key={key}
                            className="visual-card visual-image-card"
                            onClick={() => openPhotoOverlay(itemId, sourceUrl || thumbUrl, groupedItems[groupKey])}
                            style={{ cursor: 'pointer' }}
                          >
                            <img
                              src={thumbUrl || sourceUrl}
                              alt={title}
                              loading="lazy"
                              onError={(event) => {
                                const img = event.currentTarget;
                                const fallback = sourceUrl || thumbUrl;
                                if (img.dataset.fallbackApplied === 'true' || !fallback) return;
                                img.dataset.fallbackApplied = 'true';
                                img.src = fallback;
                              }}
                            />
                            <div className="visual-meta">
                              <div className="visual-title" title={title}>{title}</div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          ) : (
            <div className="visual-grid" aria-label="Photo gallery">
              {filtered.map((item) => {
                const key = String(getItemId(item) ?? item.__index ?? pickTitle(item));
                const itemId = getItemId(item);
                const title = pickTitle(item);
                const sourceUrl = pickPhotoSourceUrl(serverUrl, item);
                const thumbUrl = pickThumbnailUrl(serverUrl, item);
                return (
                  <article
                    key={key}
                    className="visual-card visual-image-card"
                    onClick={() => openPhotoOverlay(itemId, sourceUrl || thumbUrl, filtered)}
                    style={{ cursor: 'pointer' }}
                  >
                    <img
                      src={thumbUrl || sourceUrl}
                      alt={title}
                      loading="lazy"
                      onError={(event) => {
                        const img = event.currentTarget;
                        const fallback = sourceUrl || thumbUrl;
                        if (img.dataset.fallbackApplied === 'true' || !fallback) return;
                        img.dataset.fallbackApplied = 'true';
                        img.src = fallback;
                      }}
                    />
                    <div className="visual-meta">
                      <div className="visual-title" title={title}>{title}</div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {selectedPhotoId != null && selectedPhotoUrl && (
            <div
              className="photo-overlay"
              onClick={closePhotoOverlay}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
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
              }}
            >
              {/* Close Button */}
              <button
                type="button"
                onClick={closePhotoOverlay}
                className="photo-overlay-icon-button photo-overlay-close-button"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  color: 'white',
                }}
                aria-label="Close photo"
              >
                <X size={34} strokeWidth={2.75} />
              </button>

              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleSaveCurrentPhoto();
                }}
                className="photo-overlay-icon-button photo-overlay-save-button"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  color: 'white',
                }}
                aria-label="Save photo"
                title="Save photo"
              >
                <ArrowDownToLine size={30} strokeWidth={2.65} />
              </button>

              {/* Photo Counter */}
              {photoListForSlideshow.length > 1 && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '1rem',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    color: 'rgba(255, 255, 255, 0.7)',
                    fontSize: '0.9rem',
                  }}
                >
                  {currentPhotoIndex + 1} / {photoListForSlideshow.length}
                </div>
              )}

              {/* Preload adjacent photos for faster slideshow */}
              <div style={{ display: 'none' }}>
                {currentPhotoIndex > 0 && photoListForSlideshow[currentPhotoIndex - 1] && (
                  <img
                    src={pickPhotoSourceUrl(serverUrl, photoListForSlideshow[currentPhotoIndex - 1]) || pickThumbnailUrl(serverUrl, photoListForSlideshow[currentPhotoIndex - 1])}
                    alt=""
                  />
                )}
                {currentPhotoIndex + 1 < photoListForSlideshow.length && photoListForSlideshow[currentPhotoIndex + 1] && (
                  <img
                    src={pickPhotoSourceUrl(serverUrl, photoListForSlideshow[currentPhotoIndex + 1]) || pickThumbnailUrl(serverUrl, photoListForSlideshow[currentPhotoIndex + 1])}
                    alt=""
                  />
                )}
                {currentPhotoIndex + 2 < photoListForSlideshow.length && photoListForSlideshow[currentPhotoIndex + 2] && (
                  <img
                    src={pickPhotoSourceUrl(serverUrl, photoListForSlideshow[currentPhotoIndex + 2]) || pickThumbnailUrl(serverUrl, photoListForSlideshow[currentPhotoIndex + 2])}
                    alt=""
                  />
                )}
              </div>

              {/* Image */}
              <img
                src={selectedPhotoUrl}
                alt="Full size photo"
                onClick={(e) => e.stopPropagation()}
                style={{
                  maxWidth: '90%',
                  maxHeight: '90%',
                  objectFit: 'contain',
                  userSelect: 'none',
                }}
              />
            </div>
          )}
        </section>
      </main>
    </>
  );
}
