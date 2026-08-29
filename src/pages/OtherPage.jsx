import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  RotateCw,
  X,
  ArrowUp,
  ArrowDown,
  Download,
  ExternalLink,
  Archive,
  FileText,
  FileSpreadsheet,
  Presentation,
  Package,
  FileCode,
  File,
  Folder,
} from 'lucide-react';

import Header from '../components/Header.jsx';
import { NativeSelect, NativeSelectOption } from '../components/ui/native-select.jsx';
import { SkeletonMediaItem } from '../components/SkeletonMediaItem.jsx';
import {
  clearMediaCache,
  fetchMediaItemsCached,
  getCachedMediaItems,
  getMediaEndpoint,
} from '../functions/mediaApiCache.js';
import {
  getMediaType,
  getItemId,
  pickTitle,
  pickFolderName,
  pickDateValue,
  pickSourceUrl,
  formatBytes,
  pickExtension,
  filterItems,
  sortFolderKeys,
} from '../functions/mediaUtils.js';
import { showToast } from '../functions/queueService.js';

const SETTINGS_KEY = 'localstream_other_settings';

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.hiddenFolders)) parsed.hiddenFolders = [];
      if (!parsed.sortKey || parsed.sortKey === 'original') parsed.sortKey = 'date';
      return parsed;
    }
  } catch {
    // ignore
  }
  return { sortKey: 'date', hiddenFolders: [] };
}

function saveSettings(patch) {
  try {
    const existing = loadSettings();
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...existing, ...patch }));
  } catch {
    // ignore
  }
}

function FileTypeIcon({ ext }) {
  const e = (ext || '').toLowerCase();
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'tgz'].includes(e)) {
    return <Archive size={20} className="file-type-icon icon-archive" />;
  }
  if (['pdf'].includes(e)) {
    return <FileText size={20} className="file-type-icon icon-pdf" />;
  }
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'epub', 'mobi'].includes(e)) {
    return <FileText size={20} className="file-type-icon icon-doc" />;
  }
  if (['xls', 'xlsx', 'csv', 'ods', 'tsv'].includes(e)) {
    return <FileSpreadsheet size={20} className="file-type-icon icon-sheet" />;
  }
  if (['ppt', 'pptx', 'odp'].includes(e)) {
    return <Presentation size={20} className="file-type-icon icon-presentation" />;
  }
  if (['apk', 'exe', 'msi', 'dmg', 'deb', 'rpm', 'appimage', 'pkg'].includes(e)) {
    return <Package size={20} className="file-type-icon icon-package" />;
  }
  if (['json', 'xml', 'yaml', 'yml', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'c', 'cpp', 'java', 'go', 'rs', 'sh', 'bat', 'ps1'].includes(e)) {
    return <FileCode size={20} className="file-type-icon icon-code" />;
  }
  return <File size={20} className="file-type-icon icon-default" />;
}

export default function OtherPage({
  serverUrl,
  onChangeServer,
  onNavigate,
  isActivePage = true,
  playbackSnapshot = null,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [allItems, setAllItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [sortKey, setSortKey] = useState(() => {
    const s = loadSettings().sortKey;
    return (s && s !== 'original') ? s : 'date';
  });
  const [isSortReversed, setIsSortReversed] = useState(() => loadSettings().isSortReversed ?? true);
  const [groupByFolder, setGroupByFolder] = useState(() => loadSettings().groupByFolder ?? true);
  const [hiddenFolders, setHiddenFolders] = useState(() => loadSettings().hiddenFolders ?? []);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [renderLimit, setRenderLimit] = useState(50);

  const searchInputRef = useRef(null);
  const fileListRef = useRef(null);

  // Persist settings
  useEffect(() => { saveSettings({ sortKey }); }, [sortKey]);
  useEffect(() => { saveSettings({ isSortReversed }); }, [isSortReversed]);
  useEffect(() => { saveSettings({ groupByFolder }); }, [groupByFolder]);
  useEffect(() => { saveSettings({ hiddenFolders }); }, [hiddenFolders]);

  // Load items from server
  useEffect(() => {
    if (!serverUrl) {
      setAllItems([]);
      return;
    }

    const cached = getCachedMediaItems(serverUrl);
    if (cached) {
      const items = cached
        .map((item, index) => ({ ...item, __index: index }))
        .filter((item) => getMediaType(item) === 'OTHER');
      setAllItems(items);
    } else {
      setAllItems([]);
    }

    setLoading(true);
    setError('');

    let cancelled = false;

    fetchMediaItemsCached(serverUrl)
      .then((rawItems) => {
        if (cancelled) return;
        const items = (rawItems || [])
          .map((item, index) => ({ ...item, __index: index }))
          .filter((item) => getMediaType(item) === 'OTHER');
        setAllItems(items);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        const endpoint = getMediaEndpoint(serverUrl);
        setError(
          'Could not load files from ' +
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

  // Filter search
  const filtered = useMemo(() => {
    return filterItems(allItems, searchQuery);
  }, [allItems, searchQuery]);

  // Sort items
  const sortedItems = useMemo(() => {
    const list = filtered.slice();
    list.sort((a, b) => {
      if (sortKey === 'name') {
        const an = (pickTitle(a) || '').toLowerCase();
        const bn = (pickTitle(b) || '').toLowerCase();
        if (an < bn) return isSortReversed ? 1 : -1;
        if (an > bn) return isSortReversed ? -1 : 1;
        return 0;
      }

      // Default: date
      const ad = pickDateValue(a);
      const bd = pickDateValue(b);
      return isSortReversed ? bd - ad : ad - bd;
    });
    return list;
  }, [filtered, sortKey, isSortReversed]);

  // Group by folder
  const groups = useMemo(() => {
    if (!groupByFolder) return {};
    const map = {};
    sortedItems.forEach((item) => {
      const folder = pickFolderName(item) || 'Other';
      if (!map[folder]) map[folder] = [];
      map[folder].push(item);
    });
    return map;
  }, [sortedItems, groupByFolder]);

  const groupKeys = useMemo(() => {
    if (!groupByFolder) return [];
    const keys = Object.keys(groups);
    return sortFolderKeys(keys, sortedItems, sortKey, isSortReversed);
  }, [groups, groupByFolder, sortedItems, sortKey, isSortReversed]);

  const hiddenFolderSet = useMemo(() => new Set(hiddenFolders), [hiddenFolders]);
  const areAllFoldersHidden = groupKeys.length > 0 && groupKeys.every((k) => hiddenFolderSet.has(k));

  const toggleFolder = useCallback((folder) => {
    setHiddenFolders((prev) => {
      const next = Array.isArray(prev) ? prev.slice() : [];
      const idx = next.indexOf(folder);
      if (idx >= 0) {
        next.splice(idx, 1);
      } else {
        next.push(folder);
      }
      return next;
    });
  }, []);

  const toggleAllFolders = useCallback(() => {
    if (areAllFoldersHidden) {
      setHiddenFolders([]);
    } else {
      setHiddenFolders([...groupKeys]);
    }
  }, [areAllFoldersHidden, groupKeys]);

  // Scrollbar thumb sync
  const handleScroll = useCallback(() => {
    const list = fileListRef.current;
    if (!list) return;

    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 300) {
      setRenderLimit((prev) => Math.min(prev + 40, sortedItems.length));
    }
  }, [sortedItems.length]);

  const handleOpenItem = (item) => {
    const url = pickSourceUrl(serverUrl, item);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleReload = () => {
    clearMediaCache(serverUrl);
    setReloadNonce((n) => n + 1);
    showToast({ action: 'refresh', message: 'Refreshing file list…' });
  };

  const hasItems = allItems.length > 0;

  return (
    <div className="media-page-container">
      <Header
        title="Other Files"
        serverUrl={serverUrl}
        activeSection="other"
        onNavigate={onNavigate}
        onChangeServer={onChangeServer}
        reloadNonce={reloadNonce}
        isActivePage={isActivePage}
        playbackSnapshot={playbackSnapshot}
      />

      <main className="page music-page other-page">
        <section className="card full music-player-card">
          {loading && allItems.length === 0 && (
            <div id="loading" className="info">
              Loading files from LocalStream…
            </div>
          )}

          {error && !loading && (
            <div id="error" className="error">
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

          {!loading && !error && !hasItems && (
            <div id="empty" className="info">
              No other files found on this server.
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
                  id="search-input"
                  type="search"
                  placeholder="Search by name, extension, or folder…"
                  aria-label="Search files"
                  value={searchQuery}
                  ref={searchInputRef}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
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
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="sort-row">
              <label htmlFor="sort-select" className="sort-label">
                Sort by
              </label>
              <NativeSelect
                id="sort-select"
                aria-label="Sort file list"
                value={sortKey}
                onChange={(e) => {
                  const val = e.target.value || 'date';
                  setSortKey(val);
                  showToast({ action: 'sort', message: `Sort by: ${val === 'date' ? 'Date' : 'Name'}` });
                }}
              >
                <NativeSelectOption value="date">Date</NativeSelectOption>
                <NativeSelectOption value="name">Name</NativeSelectOption>
              </NativeSelect>

              <button
                id="sort-reverse"
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
                {isSortReversed ? <ArrowDown size={16} /> : <ArrowUp size={16} />}
              </button>

              <button
                id="group-folder-toggle"
                type="button"
                className={'icon-button sort-icon-button sort-toggle' + (groupByFolder ? ' toggle-active' : '')}
                aria-label={groupByFolder ? 'Grouped by folder (click to ungroup)' : 'Ungrouped (click to group by folder)'}
                title={groupByFolder ? 'Grouped by folder' : 'Ungrouped'}
                aria-pressed={groupByFolder ? 'true' : 'false'}
                onClick={() => {
                  const next = !groupByFolder;
                  setGroupByFolder(next);
                  showToast({
                    action: 'group_folder',
                    groupByFolder: next,
                    message: next ? 'Grouped by folder' : 'Ungrouped',
                  });
                }}
              >
                <Folder size={16} />
              </button>

              <button
                id="reload"
                type="button"
                className="icon-button sort-icon-button"
                aria-label="Refresh file list"
                title="Refresh file list"
                onClick={handleReload}
              >
                <RotateCw size={16} />
              </button>
            </div>
          </div>

          {/* File list */}
          <div className="music-list-shell">
            {loading && allItems.length === 0 ? (
              <ul className="music-list" aria-label="Loading files">
                {Array.from({ length: 10 }).map((_, i) => (
                  <SkeletonMediaItem key={`loading-skel-${i}`} />
                ))}
              </ul>
            ) : (
              <ul
                id="music-list"
                className="music-list other-file-list"
                ref={fileListRef}
                onScroll={handleScroll}
                aria-label={groupByFolder ? 'File list grouped by folder' : 'File list'}
              >
                {(() => {
                  let renderedCount = 0;
                  const renderTrackItem = (item) => {
                    const id = getItemId(item);
                    const title = pickTitle(item) || 'Unnamed file';
                    const folder = pickFolderName(item);
                    const ext = pickExtension(item);
                    const sizeStr = formatBytes(item.size || item.fileSize || item.length);
                    const sourceUrl = pickSourceUrl(serverUrl, item);

                    const metaParts = [];
                    if (folder) metaParts.push(folder);
                    if (sizeStr) metaParts.push(sizeStr);
                    if (ext) metaParts.push(ext.toUpperCase());

                    return (
                      <li
                        key={id != null ? id : `file-${item.__index}`}
                        className="music-item file-item"
                        onClick={() => handleOpenItem(item)}
                        style={{ cursor: 'pointer' }}
                        tabIndex={0}
                        role="button"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleOpenItem(item);
                          }
                        }}
                      >
                        <div className="music-art file-icon-art">
                          <FileTypeIcon ext={ext} />
                        </div>

                        <div className="music-main">
                          <div className="music-title" title={title}>
                            {title}
                          </div>
                          <div className="music-details">
                            <div className="music-artist">{metaParts.join(' \u2022 ')}</div>
                          </div>
                        </div>

                        <div className="music-actions file-actions">
                          <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            download={title}
                            className="icon-button file-download-btn"
                            aria-label={`Download ${title}`}
                            title="Download / Open in new tab"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Download size={18} />
                          </a>
                        </div>
                      </li>
                    );
                  };

                  if (groupByFolder) {
                    return (
                      <>
                        <li className="folder-header">
                          <span className="folder-name">All</span>
                          <button
                            type="button"
                            className="secondary folder-hide-button"
                            aria-label={areAllFoldersHidden ? 'Show all folders' : 'Hide all folders'}
                            onClick={toggleAllFolders}
                          >
                            {areAllFoldersHidden ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </li>

                        {groupKeys.map((groupKey) => {
                          const groupItems = groups[groupKey] || [];
                          const isHidden = hiddenFolderSet.has(groupKey);
                          const remainingLimit = Math.max(0, renderLimit - renderedCount);
                          const visibleItems = isHidden ? [] : groupItems.slice(0, remainingLimit);
                          renderedCount += visibleItems.length;

                          return (
                            <React.Fragment key={groupKey}>
                              <li className="folder-header">
                                <span className="folder-name">
                                  {groupKey} ({groupItems.length})
                                </span>
                                <button
                                  type="button"
                                  className="secondary folder-hide-button"
                                  aria-label={isHidden ? `Show files in ${groupKey}` : `Hide files in ${groupKey}`}
                                  onClick={() => toggleFolder(groupKey)}
                                >
                                  {isHidden ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                </button>
                              </li>
                              {!isHidden && visibleItems.map(renderTrackItem)}
                            </React.Fragment>
                          );
                        })}
                      </>
                    );
                  }

                  const visibleItems = sortedItems.slice(0, renderLimit);
                  return visibleItems.map(renderTrackItem);
                })()}

                {renderLimit < (groupByFolder ? filtered.length : sortedItems.length) && (
                  <>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <SkeletonMediaItem key={`skel-bottom-${i}`} />
                    ))}
                  </>
                )}
              </ul>
            )}

            <div className="music-side-rail">
              <button
                type="button"
                className="scroll-edge-button"
                aria-label="Scroll to top of list"
                onClick={() => {
                  fileListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                disabled={sortedItems.length === 0}
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                className="scroll-edge-button"
                aria-label="Scroll to bottom of list"
                onClick={() => {
                  setRenderLimit(sortedItems.length);
                  setTimeout(() => {
                    const el = fileListRef.current;
                    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
                  }, 0);
                }}
                disabled={sortedItems.length === 0}
              >
                <ChevronDown size={16} />
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

