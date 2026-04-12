// Returns a folder name for grouping, similar to MediaPage
export function pickFolderName(item) {
  const direct =
    item.folder ||
    item.folderName ||
    item.container ||
    item.parent ||
    item.parentTitle ||
    '';
  if (direct) return String(direct);

  const path =
    item.path ||
    item.filePath ||
    item.filepath ||
    item.fullPath ||
    item.location ||
    '';

  if (path) {
    const parts = String(path).split(/[\\/]+/).filter(Boolean);
    if (parts.length > 0) {
      // For images, use the last segment as the folder name
      if ((item.type || item.mediaType || item.kind || '').toUpperCase() === 'IMAGE') {
        return parts[parts.length - 2] || parts[parts.length - 1];
      }
      // For other types, use parent folder as before
      if (parts.length > 1) {
        return parts[parts.length - 2];
      }
    }
  }

  return 'Unknown folder';
}
/**
 * Shared utility functions for media handling across all pages (Music, Video, Photo)
 */

export function getItemId(item) {
  if (!item) return null;
  const id = item.id ?? item.mediaId ?? item.videoId ?? item.imageId ?? item.audioId;
  return id != null ? id : null;
}

export function pickTitle(item) {
  if (!item) return 'Untitled';
  const raw = item.title || item.name || item.fileName || item.filename || '';
  const text = String(raw).trim();
  return text || 'Untitled';
}

export function pickDateValue(item) {
  if (!item) return 0;
  const raw =
    item.date ||
    item.added ||
    item.addedAt ||
    item.createdAt ||
    item.modifiedAt ||
    item.lastModified ||
    item.mtime ||
    item.timestamp ||
    '';
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  const fromDate = Date.parse(String(raw));
  if (Number.isNaN(fromDate)) return 0;
  return fromDate;
}

export function normalizeDurationSeconds(raw) {
  if (raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;

  if (n > 6000 && n < 60 * 60 * 24 * 1000) {
    return Math.round(n / 1000);
  }

  return Math.round(n);
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins + ':' + (secs < 10 ? '0' + secs : secs);
}

export function pickDuration(item) {
  const base = item && (item.duration || item.lengthSeconds || item.seconds);
  const s = normalizeDurationSeconds(base);
  if (!s) return '';
  return formatTime(s);
}

export function pickDurationSeconds(item) {
  const base = item && (item.duration || item.lengthSeconds || item.seconds);
  return normalizeDurationSeconds(base);
}

export function pickRelativeOrAbsoluteUrl(serverUrl, raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) {
    return text;
  }

  const base = (serverUrl || '').replace(/\/$/, '');
  if (!base) return text;

  if (text.startsWith('/')) {
    return base + text;
  }

  return base + '/' + text;
}

export function pickThumbnailUrl(serverUrl, item) {
  const fromItem =
    item &&
    (item.thumbnail || item.thumb || item.poster || item.preview || item.albumArt || '');

  const direct = pickRelativeOrAbsoluteUrl(serverUrl, fromItem);
  if (direct) return direct;

  const id = getItemId(item);
  if (id == null) return '';

  const base = (serverUrl || '').replace(/\/$/, '');
  if (!base) return '';

  const type = (item && (item.type || item.mediaType || item.kind || '').toUpperCase()) || '';
  let mediaTypePath = 'video';
  if (type === 'IMAGE') mediaTypePath = 'image';
  else if (type === 'AUDIO') mediaTypePath = 'audio';

  return base + '/thumbnail/' + mediaTypePath + '/' + encodeURIComponent(id);
}

export function pickSourceUrl(serverUrl, item) {
  const id = getItemId(item);
  const base = (serverUrl || '').replace(/\/$/, '');

  const type = (item && (item.type || item.mediaType || item.kind || '').toUpperCase()) || '';
  let mediaTypePath = 'video';
  if (type === 'IMAGE') mediaTypePath = 'image';
  else if (type === 'AUDIO') mediaTypePath = 'audio';

  if (base && id != null) {
    return base + '/media/' + mediaTypePath + '/' + encodeURIComponent(id);
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

  const direct = pickRelativeOrAbsoluteUrl(serverUrl, directRaw);
  if (direct) return direct;

  if (id == null) return '';
  if (!base) return '';

  return base + '/media/' + mediaTypePath + '/' + encodeURIComponent(id);
}

export function filterItems(items, query) {
  if (!query) return items;
  const q = String(query).trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const fields = [
      pickTitle(item),
      item && (item.fileName || item.filename || item.name || ''),
    ];
    return fields
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  });
}

export function sortItems(items, sortKey, isSortReversed) {
  const arr = (items || []).slice();

  arr.sort((a, b) => {
    if (sortKey === 'name') {
      const an = pickTitle(a).toLowerCase();
      const bn = pickTitle(b).toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    }

    const ad = pickDateValue(a);
    const bd = pickDateValue(b);
    return ad - bd;
  });

  if (isSortReversed) arr.reverse();
  return arr;
}

export function getMediaType(item) {
  const raw = (item && (item.type || item.mediaType || item.kind || '')) || '';
  return String(raw).trim().toUpperCase();
}
