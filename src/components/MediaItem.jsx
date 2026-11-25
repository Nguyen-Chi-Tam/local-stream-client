import React, { useState, useRef, useEffect } from 'react';
import { Play, MoreVertical, Download, ExternalLink, ListPlus, ListX, CornerUpLeft, Trash2 } from 'lucide-react';
import DynamicIslandWaveform from './DynamicIslandWaveform.jsx';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu.jsx';
import {
  getItemId,
  getMediaType,
  pickTitle,
  pickArtist,
  pickFolderName,
  pickDuration,
  pickThumbnailUrl,
  pickSourceUrl,
  getDefaultArtForType,
} from '../functions/mediaUtils.js';
import { useQueue, getQueue, showToast } from '../functions/queueService.js';
import { isTauriRuntime } from '../functions/desktopBridge.js';

const MIME_EXT_MAP = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
  'audio/x-ms-wma': 'wma',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
};

function extractItemExtension(item, contentType = '') {
  const candidates = [
    item?.fileName,
    item?.filename,
    item?.name,
    item?.path,
    item?.filePath,
    item?.filepath,
    item?.fullPath,
    item?.location,
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const base = String(raw).split(/[\\/]/).pop() || '';
    const match = base.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (match) return match[1].toLowerCase();
  }
  const mime = String(contentType || item?.mimeType || item?.mime || item?.contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (MIME_EXT_MAP[mime]) return MIME_EXT_MAP[mime];
  return '';
}

function buildMediaDownloadFilename(item, contentType = '', isVideo = false) {
  const rawTitle = (pickTitle(item) || 'media').trim();
  const safeTitle = rawTitle
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim() || 'media';
  const ext = extractItemExtension(item, contentType) || (isVideo ? 'mp4' : 'mp3');
  if (safeTitle.toLowerCase().endsWith(`.${ext}`)) {
    return safeTitle;
  }
  return `${safeTitle}.${ext}`;
}

function LazyImage({ src, alt, className, onError }) {
  const [isVisible, setIsVisible] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '400px' });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={imgRef} className="skeleton-art" style={{ width: '100%', height: '100%', borderRadius: 'inherit', overflow: 'hidden' }}>
      {isVisible && (
        <img
          src={src}
          alt={alt}
          className={className}
          loading="lazy"
          decoding="async"
          onError={(e) => {
            if (onError) onError(e);
            e.currentTarget.style.opacity = '1';
          }}
          style={{ opacity: 0, transition: 'opacity 0.3s ease', borderRadius: 'inherit' }}
          onLoad={(e) => { e.currentTarget.style.opacity = '1'; }}
        />
      )}
    </div>
  );
}

function getItemDomKey(item) {
  if (!item) return '';
  const id = getItemId(item);
  if (id != null) return String(id);
  return String(item.path || item.filePath || item.url || item.__index || '');
}

const MediaItem = React.memo(({
  item,
  isActive,
  isPlayingActive,
  serverUrl,
  onSelect,
  onPlay,
  subtitle,
  onMenuClick,
  groupByFolder,
}) => {
  const [isNearViewport, setIsNearViewport] = useState(false);
  const ref = useRef();
  const { queue, isItemQueued, getQueuePosition, addToQueue, addToQueueStart, removeFromQueue, clearQueue } = useQueue();
  const totalQueued = Math.max(queue?.length || 0, getQueue().length);

  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      setIsNearViewport(entry.isIntersecting);
    }, { rootMargin: '1200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleAction = onSelect || onPlay;
  const mediaType = getMediaType(item);
  const isVideoItem = mediaType === 'VIDEO' || subtitle === 'Video';
  const fallbackArt = getDefaultArtForType(isVideoItem ? 'VIDEO' : mediaType);
  const artUrl = pickThumbnailUrl(serverUrl, item, isVideoItem ? 'VIDEO' : mediaType);
  const domKey = getItemDomKey(item);
  const sourceUrl = pickSourceUrl(serverUrl, item) || artUrl;

  const isQueued = isItemQueued(item);
  const queuePos = getQueuePosition(item);

  const displaySubtitle = subtitle != null 
    ? subtitle 
    : (pickArtist(item) || (groupByFolder ? '' : pickFolderName(item)) || '');

  const handleOpenNewTab = (e) => {
    e.stopPropagation();
    if (sourceUrl && typeof window !== 'undefined') {
      window.open(sourceUrl, '_blank');
    }
  };

  const handleDownload = async (e) => {
    e.stopPropagation();
    if (!sourceUrl || typeof window === 'undefined') return;

    const inTauri = isTauriRuntime();

    try {
      const response = await fetch(sourceUrl, { mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentType = response.headers.get('content-type') || '';
      const filename = buildMediaDownloadFilename(item, contentType, isVideoItem);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 3000);

      if (inTauri) {
        showToast({
          action: 'download',
          item,
          message: 'Downloaded audio',
        });
      }
    } catch {
      const filename = buildMediaDownloadFilename(item, '', isVideoItem);
      if (inTauri) {
        showToast({
          action: 'remove',
          item,
          message: 'Failed to download audio',
        });
        return;
      }
      const isProxyUrl = sourceUrl.startsWith('/__media');
      const fallbackHref = isProxyUrl
        ? `${sourceUrl}&download=${encodeURIComponent(filename)}`
        : sourceUrl;
      const a = document.createElement('a');
      a.href = fallbackHref;
      a.download = filename;
      if (!isProxyUrl) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleAddToStart = (e) => {
    e.stopPropagation();
    addToQueueStart(item);
  };

  const handleAddToEnd = (e) => {
    e.stopPropagation();
    addToQueue(item);
  };

  const handleRemoveFromQueue = (e) => {
    e.stopPropagation();
    removeFromQueue(item);
  };

  const handleClearQueue = (e) => {
    e.stopPropagation();
    clearQueue();
  };

  return (
    <li
      ref={ref}
      className={'music-item' + (isQueued ? ' is-queued-item' : '')}
      key={domKey || (getItemId(item) ?? item.__index)}
      data-track-key={domKey}
      style={{ minHeight: typeof window !== 'undefined' && (window.innerWidth <= 380 || window.innerHeight < 700) ? '46px' : '60px' }}
    >
      {isNearViewport ? (
        <>
          <DropdownMenu modal={false} onOpenChange={setIsMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={'media-item-menu-btn' + (isMenuOpen ? ' is-menu-open' : '')}
                aria-label="Media options"
                title="More options"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              sideOffset={4}
              className="w-48 backdrop-blur-md z-[1000]"
              onClick={(e) => e.stopPropagation()}
            >
              {((!isQueued && totalQueued > 0) || (isQueued && queuePos > 1)) && (
                <DropdownMenuItem
                  className="cursor-pointer hover:bg-slate-800/90 text-slate-200 gap-2.5 text-xs py-2 px-2.5 rounded-lg focus:bg-slate-800 focus:text-amber-400 transition-colors"
                  onClick={handleAddToStart}
                >
                  <CornerUpLeft size={14} className="text-amber-400 flex-shrink-0" />
                  <span>{isQueued && queuePos > 1 ? `Move to queue start (#1)` : `Play next`}</span>
                </DropdownMenuItem>
              )}

              {!isQueued ? (
                <DropdownMenuItem
                  className="cursor-pointer hover:bg-slate-800/90 text-slate-200 gap-2.5 text-xs py-2 px-2.5 rounded-lg focus:bg-slate-800 focus:text-emerald-400 transition-colors"
                  onClick={handleAddToEnd}
                >
                  <ListPlus size={14} className="text-emerald-400 flex-shrink-0" />
                  <span>Add to queue</span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="cursor-pointer hover:bg-red-500/20 text-red-400 gap-2.5 text-xs py-2 px-2.5 rounded-lg focus:bg-red-500/20 focus:text-red-300 transition-colors"
                  onClick={handleRemoveFromQueue}
                >
                  <ListX size={14} className="flex-shrink-0" />
                  <span>Remove from queue {queuePos ? `(#${queuePos})` : ''}</span>
                </DropdownMenuItem>
              )}

              {totalQueued > (isQueued ? 1 : 0) && (
                <DropdownMenuItem
                  className="cursor-pointer hover:bg-red-500/20 text-red-400 gap-2.5 text-xs py-2 px-2.5 rounded-lg focus:bg-red-500/20 focus:text-red-300 transition-colors"
                  onClick={handleClearQueue}
                >
                  <Trash2 size={14} className="flex-shrink-0" />
                  <span>Clear queue</span>
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator className="my-1 bg-slate-800/80" />

              {isVideoItem ? (
                <DropdownMenuItem
                  className="cursor-pointer hover:bg-slate-800/90 gap-2.5 text-xs py-2 px-2.5 rounded-lg focus:bg-slate-800 focus:text-cyan-400 transition-colors"
                  onClick={handleOpenNewTab}
                >
                  <ExternalLink size={14} className="text-cyan-400 flex-shrink-0" />
                  <span>Open in new tab</span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="cursor-pointer hover:bg-slate-800/90 gap-2.5 text-xs py-2 px-2.5 rounded-lg focus:bg-slate-800 focus:text-cyan-400 transition-colors"
                  onClick={handleDownload}
                >
                  <Download size={14} className="text-cyan-400 flex-shrink-0" />
                  <span>Download</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="music-art">
            <LazyImage
              src={artUrl}
              alt={pickTitle(item)}
              onError={(event) => {
                const img = event.currentTarget;
                if (img.dataset.fallbackApplied === 'true') return;
                img.dataset.fallbackApplied = 'true';
                img.src = fallbackArt;
                img.style.opacity = '1';
              }}
            />
          </div>

          <div className="music-main">
            <div className={'music-title' + (isActive ? ' playing-title' : '')}>
              {pickTitle(item)}
            </div>
            <div className="music-details">
              <div className="music-artist">{displaySubtitle}</div>
              <div className="music-meta">
                {isQueued && <span className="queue-tag">#{queuePos}</span>}
                {pickDuration(item)}
              </div>
            </div>
          </div>
          <div className="music-actions">
            <button
              type="button"
              className={isActive ? 'playing' : ''}
              aria-label={isActive ? (isPlayingActive ? 'Pause' : 'Playing') : 'Play'}
              onClick={() => handleAction && handleAction(item)}
            >
              {isActive ? (
                <DynamicIslandWaveform isPlaying={isPlayingActive !== false} />
              ) : (
                <Play size={18} fill="currentColor" stroke="none" />
              )}
            </button>
          </div>
        </>
      ) : null}
    </li>
  );
}, (prevProps, nextProps) => {
  return prevProps.item === nextProps.item &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.isPlayingActive === nextProps.isPlayingActive &&
    prevProps.serverUrl === nextProps.serverUrl &&
    prevProps.subtitle === nextProps.subtitle &&
    prevProps.groupByFolder === nextProps.groupByFolder;
});

export default MediaItem;
