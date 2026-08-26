// Returns the canonical photo source URL for an item
export function pickPhotoSourceUrl(serverUrl, item) {
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


const MOJIBAKE_BYTE_MAP = {
  '锘': [0xEF, 0xBB, 0xBF],
  '谩': [0xC3, 0xA1],
  '芒': [0xC3, 0xA2],
  '茫': [0xC3, 0xA3],
  '盲': [0xC3, 0xA4],
  '猫': [0xC3, 0xA8],
  '茅': [0xC3, 0xA9],
  '锚': [0xC3, 0xAA],
  '靓': [0xC3, 0xAC],
  '貌': [0xC3, 0xB2],
  '贸': [0xC3, 0xB3],
  '么': [0xC3, 0xB4],
  '玫': [0xC3, 0xB5],
  '霉': [0xC3, 0xB9],
  '煤': [0xC3, 0xBA],
  '膼': [0xC4, 0x90],
  '膽': [0xC4, 0x91],
  '胰': [0xE1, 0xBA],
  '鑞': [0xE1, 0xBB],
  '峄': [0xE1, 0xBB],
  '憐': [0x87],
  '當': [0xE1, 0xBA],
  'ďťż': [0xEF, 0xBB, 0xBF],
};

export function decodeMojibakeString(str) {
  if (!str || typeof str !== 'string') return str;
  if (!isMojibake(str)) return str;

  try {
    const bytes = [];
    let modified = false;

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (MOJIBAKE_BYTE_MAP[char]) {
        bytes.push(...MOJIBAKE_BYTE_MAP[char]);
        modified = true;
      } else {
        const code = str.charCodeAt(i);
        if (code <= 0x7F) {
          bytes.push(code);
        } else if (code <= 0xFF) {
          bytes.push(code);
          modified = true;
        } else {
          const encoded = new TextEncoder().encode(char);
          bytes.push(...encoded);
        }
      }
    }

    if (modified) {
      // Use fatal: true so incomplete/corrupted byte sequences throw instead of producing replacement characters that strip into mangled strings (like "Tam Gi ")
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
      const cleaned = decoded.replace(/[\uFEFF\u0000]/g, '').trim();
      if (cleaned && !isMojibake(cleaned)) {
        return cleaned;
      }
    }
  } catch {}

  try {
    const latinBytes = new Uint8Array(str.length);
    let validLatin1 = true;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c > 255) { validLatin1 = false; break; }
      latinBytes[i] = c;
    }
    if (validLatin1) {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(latinBytes);
      const cleaned = decoded.replace(/[\uFEFF\u0000]/g, '').trim();
      if (cleaned && !isMojibake(cleaned)) {
        return cleaned;
      }
    }
  } catch {}

  return str;
}

// Detect titles that look like mojibake (garbled encoding).
export function isMojibake(text) {
  if (!text || typeof text !== 'string') return false;

  const globalArtifacts = /锘|谩|芒|茫|盲|猫|茅|锚|靓|貌|贸|么|玫|霉|鑞|煤|膼|膽|當|ďťż|Ã©|Ã³|Ã¡|Ã±|â€|Ðœ|Ð¾|ě|ŕ|ę|縑|縉|ď|ť|ż|盻|ｯ|雪|ｻ|ｩ|蘯|ハ|冢|ﾄ/i;
  if (globalArtifacts.test(text)) return true;

  if (text.includes('锘') || text.includes('谩') || text.includes('縑') || text.includes('縉')) return true;
  if (text.includes('ďťż') || text.includes('???') || text.includes('\uFFFD')) return true;

  if (/[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9][\uFF61-\uFF9F]|[\uFF61-\uFF9F][a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]/.test(text)) return true;

  if (/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF][a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]|[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9][\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(text)) return true;

  const hasCJK = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(text);
  const hasLatinLetters = /[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]/.test(text);
  if (hasCJK && hasLatinLetters) {
    return true;
  }

  if (hasCJK) {
    let hasHiddenSpace = false;
    let hasInvalidByte = false;

    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (code <= 0x00ff) continue;

      const byte1 = code >> 8;
      const byte2 = code & 0xff;

      if (byte1 === 0x20 || byte2 === 0x20) {
        hasHiddenSpace = true;
      }

      const isInvalidByte1 = byte1 < 0x20 && ![0x00, 0x09, 0x0a, 0x0d].includes(byte1);
      const isInvalidByte2 = byte2 < 0x20 && ![0x00, 0x09, 0x0a, 0x0d].includes(byte2);
      if (isInvalidByte1 || isInvalidByte2) {
        hasInvalidByte = true;
      }
    }

    if (hasHiddenSpace || hasInvalidByte) {
      return true;
    }
  }

  return false;
}

// Detect titles where a bad YouTube converter silently stripped Vietnamese
// diacritics.  We compare the Vietnamese character density of the ID3 title
// against the file-path fallback – if the path has significantly more
// diacritics, the ID3 tag was destructively written.
const VIETNAMESE_DIACRITICS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/g;

export function isSilentlyStripped(id3Title, fallbackTitle, itemArtist) {
  if (!id3Title || !fallbackTitle) return false;
  const fullId3Context = id3Title + ' ' + (itemArtist || '');
  const id3VnChars = (fullId3Context.match(VIETNAMESE_DIACRITICS) || []).length;
  const fallbackVnChars = (fallbackTitle.match(VIETNAMESE_DIACRITICS) || []).length;
  return fallbackVnChars > id3VnChars + 1;
}

// Extract a filename stem (without extension) from a raw path.
export function extractTitleFromPath(path) {
  if (!path) return '';

  const parts = String(path).split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return '';
  const fileNameWithExt = parts[parts.length - 1];
  if (!fileNameWithExt) return '';

  const lastDotIndex = fileNameWithExt.lastIndexOf('.');
  if (lastDotIndex > 0) {
    return fileNameWithExt.slice(0, lastDotIndex);
  }

  return fileNameWithExt;
}

export function pickTitle(item) {
  if (!item) return 'Untitled';

  const type = getMediaType(item);
  const isImage = type === 'IMAGE';

  const pathObj =
    item.path ||
    item.filePath ||
    item.filepath ||
    item.fullPath ||
    item.location ||
    item.url ||
    item.streamUrl ||
    '';
  const fromPath = extractTitleFromPath(pathObj);
  const cleanFromPath = fromPath
    ? fromPath.replace(/\s*\([^)]*_(?:\d+K|\d+KB|\d+MB)\)\s*$/i, '').trim()
    : '';

  if (isImage) {
    if (cleanFromPath) return cleanFromPath;
    const raw = item.title || item.name || item.fileName || item.filename || '';
    return String(raw).trim() || 'Untitled';
  }

  const raw = item.title || item.name || item.fileName || item.filename || '';
  const rawText = String(raw).trim();
  const artist = item.artist || item.albumArtist || '';

  const rawIsGarbled = isMojibake(rawText);

  let text = rawText;

  if (rawIsGarbled || !rawText) {
    if (cleanFromPath && !isMojibake(cleanFromPath)) {
      return cleanFromPath;
    }
    const decoded = decodeMojibakeString(rawText);
    if (decoded && decoded !== rawText && !isMojibake(decoded)) {
      text = decoded;
    } else if (cleanFromPath) {
      return cleanFromPath;
    }
  } else {
    const decoded = decodeMojibakeString(rawText);
    if (decoded && decoded !== rawText) {
      if (isMojibake(decoded) || (cleanFromPath && isSilentlyStripped(decoded, cleanFromPath, artist))) {
        if (cleanFromPath && !isMojibake(cleanFromPath)) {
          return cleanFromPath;
        }
      } else {
        text = decoded;
      }
    }
  }

  if (!text || isMojibake(text) || (cleanFromPath && isSilentlyStripped(text, cleanFromPath, artist))) {
    if (cleanFromPath && !isMojibake(cleanFromPath)) {
      return cleanFromPath;
    }
  }

  text = text.replace(/\s*\([^)]*_(?:\d+K|\d+KB|\d+MB)\)\s*$/i, '').trim();
  text = text.replace(/(\w)Ž(?=\s|$)/g, '$1®');
  text = text.replace(/[\uFEFF\uFFFD]/g, '').trim();

  if (!text || isMojibake(text)) {
    if (cleanFromPath) return cleanFromPath;
  }

  return text || cleanFromPath || 'Untitled';
}

export function isUnknownArtist(text) {
  if (!text) return true;
  const lower = String(text).trim().toLowerCase();
  if (!lower) return true;
  return /^(?:<unknown(?:\s+artist)?>|\[unknown(?:\s+artist)?\]|\(unknown(?:\s+artist)?\)|unknown(?:\s+artist)?|<none>|none|<n\/a>|n\/a|null|undefined)$/i.test(lower);
}

export function pickArtist(item) {
  if (!item) return '';
  const raw = (item && (item.artist || item.albumArtist || item.album)) || '';
  let text = String(raw).trim();
  if (!text || isUnknownArtist(text) || isMojibake(text)) return '';

  // Strip non-printable / replacement artifacts if any
  text = text.replace(/[\uFEFF\uFFFD]/g, '').trim();

  if (isUnknownArtist(text) || isMojibake(text)) return '';

  return text;
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
  if (!raw) {
    const numericId = parseInt(item.id, 10);
    if (!Number.isNaN(numericId)) return numericId;
    return 0;
  }
  if (typeof raw === 'number') return raw;
  const numericRaw = Number(raw);
  if (Number.isFinite(numericRaw)) return numericRaw;
  const fromDate = Date.parse(String(raw));
  if (Number.isNaN(fromDate)) return 0;
  return fromDate;
}

export function normalizeDurationSeconds(raw, unit = 'seconds') {
  if (raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;

  if (unit === 'milliseconds') {
    return Math.round(n / 1000);
  }

  return Math.round(n);
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return hrs + ':' + (mins < 10 ? '0' + mins : mins) + ':' + (secs < 10 ? '0' + secs : secs);
  }
  return mins + ':' + (secs < 10 ? '0' + secs : secs);
}

export function pickDuration(item) {
  const s = pickDurationSeconds(item);
  if (!s) return '';
  return formatTime(s);
}

export function pickDurationSeconds(item) {
  if (!item) return 0;
  if (item.duration != null) {
    return normalizeDurationSeconds(item.duration, 'milliseconds');
  }
  return normalizeDurationSeconds(item.lengthSeconds ?? item.seconds);
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

export function pickThumbnailUrl(serverUrl, item, mediaTypeHint) {
  if (!item) return '/default-art.png';

  const rawArt =
    item.albumArt ||
    item.thumbnail ||
    item.thumb ||
    item.poster ||
    item.preview ||
    item.art ||
    item.artwork ||
    item.cover ||
    item.picture ||
    item.image ||
    item.imageUrl ||
    '';

  const strArt = String(rawArt || '').trim();

  if (strArt === '/thumbnail/album/3579481289389474209') {
    return '/default-art.png';
  }

  if (strArt) {
    return pickRelativeOrAbsoluteUrl(serverUrl, strArt);
  }

  const type = mediaTypeHint || getMediaType(item);

  if (type === 'AUDIO') {
    return '/default-art.png';
  }

  const id = getItemId(item);
  if (id == null) return '/default-art.png';

  const base = (serverUrl || '').replace(/\/$/, '');
  if (!base) return '/default-art.png';

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

    if (sortKey === 'duration') {
      const ad = pickDurationSeconds(a);
      const bd = pickDurationSeconds(b);
      return ad - bd;
    }

    const ad = pickDateValue(a);
    const bd = pickDateValue(b);
    return ad - bd;
  });

  if (isSortReversed) arr.reverse();
  return arr;
}

export function sortFolderKeys(keys, items, sortKey, isSortReversed, getFolderName = pickFolderName) {
  const folderKeys = (keys || []).slice();

  if (sortKey !== 'date' && sortKey !== 'duration') {
    return folderKeys.sort((a, b) => {
      const comparison = a.localeCompare(b, undefined, { sensitivity: 'base' });
      return isSortReversed ? -comparison : comparison;
    });
  }

  const keySet = new Set(folderKeys);
  const boundaryDateByFolder = new Map();

  (items || []).forEach((item) => {
    const folder = getFolderName(item) || 'Other';
    if (!keySet.has(folder)) return;

    const value = sortKey === 'duration' ? pickDurationSeconds(item) : pickDateValue(item);
    const current = boundaryDateByFolder.get(folder);
    if (
      current == null ||
      (sortKey === 'duration'
        ? value > current
        : isSortReversed
          ? value > current
          : value < current)
    ) {
      boundaryDateByFolder.set(folder, value);
    }
  });

  return folderKeys.sort((a, b) => {
    const ad = boundaryDateByFolder.get(a) ?? 0;
    const bd = boundaryDateByFolder.get(b) ?? 0;
    if (ad !== bd) return isSortReversed ? bd - ad : ad - bd;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

export function getMediaType(item) {
  if (!item) return '';

  const raw = (item.type || item.mediaType || item.kind || '').toString().trim().toUpperCase();
  if (raw === 'IMAGE' || raw === 'PHOTO' || raw === 'PICTURE' || raw === 'IMG') return 'IMAGE';
  if (raw === 'AUDIO' || raw === 'MUSIC' || raw === 'SONG' || raw === 'TRACK') return 'AUDIO';
  if (raw === 'VIDEO' || raw === 'MOVIE' || raw === 'FILM' || raw === 'VID') return 'VIDEO';

  const mime = (item.mime || item.mimeType || item.contentType || '').toString().toLowerCase();
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('audio/')) return 'AUDIO';
  if (mime.startsWith('video/')) return 'VIDEO';

  const path = (item.path || item.filePath || item.fileName || item.filename || item.name || item.url || '').toString().toLowerCase();
  if (/\.(jpe?g|png|gif|webp|heic|heif|svg|bmp|tiff?|raw|dng|ico|avif)$/i.test(path)) return 'IMAGE';
  if (/\.(mp3|flac|wav|aac|ogg|m4a|wma|opus|aiff?|alac)$/i.test(path)) return 'AUDIO';
  if (/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|3gp|ts)$/i.test(path)) return 'VIDEO';

  return raw;
}
