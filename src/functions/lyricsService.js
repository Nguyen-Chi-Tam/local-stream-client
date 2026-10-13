import { isUnknownArtist } from './mediaUtils.js';

// In-memory cache for parsed lyrics: key -> lyrics result
const lyricsCache = new Map();

/**
 * Remove audio/video file extensions, track numbers, quotes, and common YouTube video tags from a track title.
 * Blacklists terms like "Lyrics", "Lyric", "MP3" and video tags.
 */
export function cleanTrackTitle(title) {
  if (!title || typeof title !== 'string') return '';
  let clean = title.trim();

  // Strip audio/video file extensions (.mp3, .flac, .wav, .m4a, .aac, .ogg, .opus, .wma, .mp4, .mkv, .webm, .avi)
  clean = clean.replace(/\.(?:mp3|flac|wav|m4a|aac|ogg|opus|wma|mp4|mkv|webm|avi)\b/gi, '');

  // Strip leading track numbers like "01. ", "01 - ", "1 "
  clean = clean.replace(/^\d+[\s.-]+/, '');

  // Strip common YouTube, MV, quality, bitrate, Lyrics, and MP3 brackets
  // Matches [MV], [M/V], [Official Video], [Official MV], (Official Music Video), (Lyric Video 4K), (Lyrics), [Lyrics], [MP3], etc.
  clean = clean.replace(/\[[^\]]*(?:official|m\/?v|video|audio|lyrics?|mp3|hd|4k|remaster|sub|vietsub|karaoke|visualizer|performance|teaser|live)[^\]]*\]/gi, '');
  clean = clean.replace(/\([^)]*(?:official|m\/?v|video|audio|lyrics?|mp3|hd|4k|remaster|sub|vietsub|karaoke|visualizer|performance|teaser|live)[^)]*\)/gi, '');
  clean = clean.replace(/\s*\([^)]*_(?:\d+K|\d+KB|\d+MB)\)\s*$/i, '');
  clean = clean.replace(/\s*\[[^\]]*(?:kbps|flac|lossless)[^\]]*\]/i, '');
  clean = clean.replace(/\s*\([^)]*(?:kbps|flac|lossless)[^)]*\)/i, '');

  // Strip pipe/dash/slash/bullet video/audio suffixes like "| Official Music Video", "- MV", "// M/V", "• Official MV", "- Lyrics", "| MP3"
  clean = clean.replace(/\s*(?:[|/\\•\-–—~:]\s*)?(?:official\s*(?:music\s*video|m\/?v|video|audio|lyric\s*video)?|m\/?v|music\s*video|lyric\s*video|visualizer|lyrics?|mp3)\s*$/gi, '');

  // Strip blacklisted standalone keywords like "MV", "M/V", "Official Video", "Lyric Video", "Lyrics", "MP3"
  clean = clean.replace(/\b(?:official\s*(?:music\s*video|video|audio|m\/?v)?|m\/?v|hd|4k|full\s*hd|lyric\s*video|visualizer|lyrics?|mp3)\b/gi, '');

  // Strip leftover trailing/leading separator symbols (| , - , / , :)
  clean = clean.replace(/[\s|/\\•\-–—~:]+$/, '');
  clean = clean.replace(/^[\s|/\\•\-–—~:]+/, '');

  // Strip single/double quotes (e.g., 'That That' -> That That)
  clean = clean.replace(/^['"“‘]+|['"”’]+$/g, '');
  clean = clean.replace(/['"“‘]([^'"”’]+)['"”’]/g, '$1');

  // Normalize excessive whitespace
  return clean.replace(/\s+/g, ' ').trim();
}

/**
 * Aggressive cleaner for secondary fallback attempts:
 * Removes all remaining bracketed text (e.g. "(prod. & feat. SUGA of BTS)"), featuring artists, etc.
 */
export function stripExtraTitleDetails(title) {
  if (!title || typeof title !== 'string') return '';
  let clean = cleanTrackTitle(title);

  // Strip all remaining parentheses, brackets, braces
  clean = clean.replace(/\s*\([^)]*\)|\s*\[[^\]]*\]|\s*\{[^}]*\}/g, '');

  // Strip featuring or producer clauses (e.g. "feat. XYZ", "ft. ABC", "prod. by 123")
  clean = clean.replace(/\s*\b(?:feat|ft|featuring|prod|produced by)\.?\s+.*$/i, '');

  // Strip blacklisted terms like Lyrics and MP3
  clean = clean.replace(/\b(?:lyrics?|mp3)\b/gi, '');

  // Strip trailing/leading separators and quotes
  clean = clean.replace(/[\s|/\\•\-–—~:]+$/, '');
  clean = clean.replace(/^[\s|/\\•\-–—~:]+/, '');
  clean = clean.replace(/^['"“‘]+|['"”’]+$/g, '');

  return clean.replace(/\s+/g, ' ').trim();
}

export const JUNK_SEGMENT_REGEX = /^(?:official\s*(?:video|audio|music\s*video|mv)?|m\/?v|lyric\s*video|visualizer|audio|full\s*hd|hd|4k|karaoke|vietsub|engsub|lossless|mv\s*hd|lyrics?|mp3|lyrics?\s*mp3|mp3\s*lyrics?|nhạc\s*mp3|nhac\s*mp3)$/i;
export const VERSION_TAG_REGEX = /^(?:special\s*version|acoustic(?:\s*version)?|live(?:\s*performance|\s*version|\s*show|\s*session)?|instrumental|remix|slowed(?:\s*\+\s*reverb)?|speed\s*up|cover|original\s*mix)$/i;

/**
 * Helper to test if a segment is purely junk/blacklisted terms (e.g. "Lyrics Mp3", "Official MV", "Audio").
 */
export function isJunkSegment(seg) {
  if (!seg) return true;
  const s = seg.trim().toLowerCase();
  if (JUNK_SEGMENT_REGEX.test(s)) return true;
  const cleanedWords = s.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
  const junkWords = new Set(['lyrics', 'lyric', 'mp3', 'audio', 'video', 'mv', 'hd', '4k', 'official', 'nhac', 'karaoke', 'vietsub', 'full']);
  if (cleanedWords.length > 0 && cleanedWords.every((w) => junkWords.has(w))) {
    return true;
  }
  return false;
}

/**
 * Normalize text for similarity matching (removes accents/diacritics, lowercase, punctuation, extra spaces).
 * Handles Vietnamese 'đ' / 'Đ'.
 */
export function normalizeText(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scores how well an LRCLIB candidate matches the target track title, artist, and duration.
 * Returns -1 if the title similarity is too low (strictly preventing selection of wrong songs).
 */
export function scoreCandidate(candidate, targetTitle, targetArtist, targetDuration, extra = {}) {
  const normTargetTitle = normalizeText(targetTitle);
  const candName = candidate.name || candidate.trackName || '';
  const normCandTitle = normalizeText(candName);
  if (!normTargetTitle || !normCandTitle) return -1;

  const targetClean = normalizeText(stripExtraTitleDetails(targetTitle));
  const candClean = normalizeText(stripExtraTitleDetails(candName));

  let titleScore = 0;
  if (normTargetTitle === normCandTitle || (targetClean && targetClean === candClean)) {
    titleScore = 100;
  } else if (normCandTitle.startsWith(normTargetTitle) || normTargetTitle.startsWith(normCandTitle) ||
             (targetClean && (candClean.startsWith(targetClean) || targetClean.startsWith(candClean)))) {
    titleScore = 85;
  } else if (normCandTitle.includes(normTargetTitle) || normTargetTitle.includes(normCandTitle) ||
             (targetClean && (candClean.includes(targetClean) || targetClean.includes(candClean)))) {
    titleScore = 75;
  } else {
    const tWords = (targetClean || normTargetTitle).split(' ').filter((w) => w.length > 0);
    const cWords = new Set((candClean || normCandTitle).split(' ').filter((w) => w.length > 0));
    const matched = tWords.filter((w) => cWords.has(w)).length;
    const ratio = tWords.length > 0 ? matched / tWords.length : 0;
    if (ratio >= 0.7) titleScore = 60 * ratio;
    else if (ratio >= 0.5) titleScore = 40 * ratio;
    else titleScore = 0;
  }

  // Strictly reject candidate if title does not match
  if (titleScore < 30) return -1;

  let totalScore = titleScore;

  if (targetArtist) {
    const normTargetArtist = normalizeText(targetArtist);
    const normCandArtist = normalizeText(candidate.artistName);
    if (normTargetArtist && normCandArtist) {
      if (normTargetArtist === normCandArtist) {
        totalScore += 50;
      } else if (normCandArtist.includes(normTargetArtist) || normTargetArtist.includes(normCandArtist)) {
        totalScore += 35;
      } else {
        const aWords = normTargetArtist.split(' ').filter((w) => w.length > 0);
        const caWords = new Set(normCandArtist.split(' ').filter((w) => w.length > 0));
        const aMatched = aWords.filter((w) => caWords.has(w)).length;
        if (aMatched > 0) totalScore += 25 * (aMatched / aWords.length);
      }
    }
  }

  if (extra.versionTag) {
    const normVer = normalizeText(extra.versionTag);
    if (normCandTitle.includes(normVer)) {
      totalScore += 20;
    }
  }

  if (targetDuration > 0 && candidate.duration > 0) {
    const diff = Math.abs(candidate.duration - targetDuration);
    if (diff <= 5) totalScore += 30;
    else if (diff <= 15) totalScore += 20;
    else if (diff <= 35) totalScore += 10;
    else if (diff > 60) totalScore -= 20;
  }

  if (candidate.syncedLyrics) totalScore += 20;

  return totalScore;
}

/**
 * Splits a title into meaningful segments, extracting version tags and removing video junk tags.
 */
export function extractSegments(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return { segments: [], versionTag: null };
  const input = rawTitle.trim();

  let rawSegments = [];
  if (input.includes('|')) {
    rawSegments = input.split('|');
  } else if (/:\s+/.test(input)) {
    rawSegments = input.split(/:\s+/);
  } else if (/\s+[-–—~•/_]\s+/.test(input)) {
    rawSegments = input.split(/\s+[-–—~•/_]\s+/);
  } else {
    const dashRegex = /([a-zA-Z0-9À-ỹ]{2,})[-–—]([a-zA-Z0-9À-ỹ]{2,})/;
    const m = dashRegex.exec(input);
    if (m) {
      const partA = input.slice(0, m.index + m[1].length);
      const partB = input.slice(m.index + m[1].length + 1);
      if (partA.includes(' ') || partB.includes(' ')) {
        rawSegments = [partA, partB];
      } else {
        rawSegments = [input];
      }
    } else {
      rawSegments = [input];
    }
  }

  let versionTag = null;
  const segments = [];
  for (const s of rawSegments) {
    if (isJunkSegment(s)) continue;
    const seg = cleanTrackTitle(s);
    if (!seg || isJunkSegment(seg)) continue;
    if (VERSION_TAG_REGEX.test(seg)) {
      versionTag = seg;
      continue;
    }
    segments.push(seg);
  }

  return { segments, versionTag };
}

/**
 * Detects if a title contains a divider symbol separating Title and Artist (legacy alias)
 */
export function splitTitleDividers(rawTitle) {
  const { segments } = extractSegments(rawTitle);
  if (segments.length >= 2) {
    return { partA: segments[0], partB: segments[1], delimiter: '-' };
  }
  return null;
}

/**
 * Extract clean track title and artist, handling dividers, version tags, and detecting Title vs Artist.
 */
export function parseTrackAndArtist(rawTitle, rawArtist) {
  const { segments, versionTag } = extractSegments(rawTitle);
  let title = cleanTrackTitle(rawTitle);
  let artist = (rawArtist || '').trim();

  if (isUnknownArtist(artist)) {
    artist = '';
  }

  let isOrientationUncertain = false;
  let partA = '', partB = '';

  if (segments.length === 2) {
    partA = segments[0];
    partB = segments[1];

    const wordsArtist = artist.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
    const overlapA = wordsArtist.filter((w) => partA.toLowerCase().includes(w)).length;
    const overlapB = wordsArtist.filter((w) => partB.toLowerCase().includes(w)).length;

    if (overlapA > overlapB) {
      artist = partA;
      title = partB;
    } else if (overlapB > overlapA) {
      artist = partB;
      title = partA;
    } else {
      title = partA;
      artist = partB;
      isOrientationUncertain = true;
    }

    return {
      title,
      artist,
      versionTag,
      split: { partA, partB },
      isOrientationUncertain,
    };
  } else if (segments.length === 1) {
    title = segments[0];
  } else if (segments.length >= 3) {
    const artistIdx = segments.findIndex((s) => {
      const words = artist.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
      return words.length > 0 && words.some((w) => s.toLowerCase().includes(w));
    });

    if (artistIdx !== -1) {
      artist = segments[artistIdx];
      const remaining = segments.filter((_, idx) => idx !== artistIdx);
      title = remaining.join(' - ');
    } else {
      title = segments[0];
      artist = segments[1];
      isOrientationUncertain = true;
    }
  }

  return {
    title,
    artist,
    versionTag,
    split: segments.length >= 2 ? { partA: segments[0], partB: segments[1] } : null,
    isOrientationUncertain,
  };
}

/**
 * Parses standard LRC text string into an array of time-sorted objects:
 * [ { time: 12.34, text: "Lyrics line" }, ... ]
 */
export function parseLRC(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return [];

  const lines = lrcText.split(/\r?\n/);
  const result = [];
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Parse [offset:+/-ms] tag
    const offsetMatch = /^\[offset:\s*([+-]?\d+)\s*\]/i.exec(trimmed);
    if (offsetMatch) {
      offset = parseInt(offsetMatch[1], 10) / 1000;
      continue;
    }

    // Skip metadata headers like [ar:...], [ti:...], [al:...], [by:...]
    if (/^\[[a-zA-Z]+:[^\]]*\]$/.test(trimmed)) {
      continue;
    }

    // Extract all timestamps from this line
    const timestamps = [];
    let match;
    timeRegex.lastIndex = 0;
    while ((match = timeRegex.exec(trimmed)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const ms = match[3] ? parseFloat('0.' + match[3]) : 0;
      const totalSeconds = minutes * 60 + seconds + ms;
      timestamps.push(totalSeconds);
    }

    if (timestamps.length > 0) {
      const text = trimmed.replace(timeRegex, '').trim();
      for (const t of timestamps) {
        result.push({
          time: Math.max(0, t + offset),
          text: text,
        });
      }
    }
  }

  // Sort lines chronologically
  result.sort((a, b) => a.time - b.time);
  return result;
}

/**
 * Helper to query LRCLIB search endpoint with given params.
 */
async function queryLrclib(params) {
  try {
    const url = new URL('https://lrclib.net/api/search');
    for (const [key, val] of Object.entries(params)) {
      if (val) url.searchParams.append(key, val);
    }
    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch {
    // Network or parse error
  }
  return [];
}

const SESSION_CACHE_PREFIX = 'local_stream_lyrics_session_';

/**
 * Derives normalized lookup keys for a track to ensure cache hits across
 * raw title, cleaned title, with or without artist.
 */
function getLookupKeys(rawTitle, rawArtist = '') {
  if (!rawTitle) return [];
  const keys = new Set();
  const rT = rawTitle.toLowerCase().trim();
  const rA = (rawArtist || '').toLowerCase().trim();
  keys.add(`${rT}___${rA}`);
  keys.add(rT);

  const clean = cleanTrackTitle(rawTitle).toLowerCase().trim();
  if (clean) {
    keys.add(`${clean}___${rA}`);
    keys.add(clean);
  }

  const parsed = parseTrackAndArtist(rawTitle, rawArtist);
  if (parsed.title) {
    const pT = parsed.title.toLowerCase().trim();
    const pA = (parsed.artist || rA).toLowerCase().trim();
    keys.add(`${pT}___${pA}`);
    keys.add(pT);
  }

  return Array.from(keys);
}

/**
 * Saves a track's lyrics to memory and browser sessionStorage for the session.
 */
export function saveSessionLyrics(rawTitle, rawArtist = '', lyricsData) {
  if (!rawTitle || !lyricsData) return;
  const keys = getLookupKeys(rawTitle, rawArtist);

  for (const k of keys) {
    lyricsCache.set(k, lyricsData);
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem(SESSION_CACHE_PREFIX + k, JSON.stringify(lyricsData));
      }
    } catch {
      // Storage quota or unavailable
    }
  }
}

/**
 * Retrieves cached lyrics for a track from memory or sessionStorage.
 */
export function getSessionLyrics(rawTitle, rawArtist = '') {
  if (!rawTitle) return null;
  const keys = getLookupKeys(rawTitle, rawArtist);

  // 1. Check in-memory cache
  for (const k of keys) {
    if (lyricsCache.has(k)) {
      return lyricsCache.get(k);
    }
  }

  // 2. Check browser sessionStorage
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      for (const k of keys) {
        const stored = window.sessionStorage.getItem(SESSION_CACHE_PREFIX + k);
        if (stored) {
          const parsed = JSON.parse(stored);
          lyricsCache.set(k, parsed);
          return parsed;
        }
      }
    }
  } catch {
    // Storage error
  }

  return null;
}

/**
 * Search and fetch time-synced lyrics from LRCLIB with smart multi-tier fallback.
 *
 * @param {string} rawTitle Track title
 * @param {string} rawArtist Artist name
 * @param {number} [duration=0] Track duration in seconds for optimal candidate matching
 * @param {boolean} [forceRefresh=false] If true, bypasses session cache and performs fresh search
 * @returns {Promise<{ synced: boolean, lines: Array<{ time: number|null, text: string }>, raw?: string, trackName?: string, artistName?: string, instrumental?: boolean, source: string } | null>}
 */
export async function fetchLyrics(rawTitle, rawArtist = '', duration = 0, forceRefresh = false) {
  const parsed = parseTrackAndArtist(rawTitle, rawArtist);
  const { title, artist, versionTag, split, isOrientationUncertain } = parsed;
  if (!title) return null;

  if (!forceRefresh) {
    const sessionCached = getSessionLyrics(rawTitle, rawArtist);
    if (sessionCached) {
      return sessionCached;
    }
  }

  try {
    const cleanCore = stripExtraTitleDetails(title);
    const queries = [];

    if (isOrientationUncertain && split) {
      const cleanA = stripExtraTitleDetails(split.partA);
      const cleanB = stripExtraTitleDetails(split.partB);
      queries.push({ targetTitle: cleanA, targetArtist: cleanB, params: { track_name: cleanA, artist_name: cleanB } });
      queries.push({ targetTitle: cleanB, targetArtist: cleanA, params: { track_name: cleanB, artist_name: cleanA } });
      queries.push({ targetTitle: cleanA, targetArtist: cleanB, params: { q: `${cleanA} ${cleanB}` } });
      queries.push({ targetTitle: cleanA, targetArtist: cleanB, params: { track_name: cleanA } });
      queries.push({ targetTitle: cleanB, targetArtist: cleanA, params: { track_name: cleanB } });
    } else {
      if (artist) {
        queries.push({ targetTitle: cleanCore, targetArtist: artist, params: { track_name: cleanCore, artist_name: artist } });
        if (versionTag) {
          queries.push({ targetTitle: `${cleanCore} (${versionTag})`, targetArtist: artist, params: { track_name: `${cleanCore} (${versionTag})`, artist_name: artist } });
        }
        if (title !== cleanCore) {
          queries.push({ targetTitle: title, targetArtist: artist, params: { track_name: title, artist_name: artist } });
        }
        queries.push({ targetTitle: cleanCore, targetArtist: artist, params: { q: `${cleanCore} ${artist}` } });
        if (versionTag) {
          queries.push({ targetTitle: cleanCore, targetArtist: artist, params: { q: `${cleanCore} ${versionTag} ${artist}` } });
        }
        if (title !== cleanCore) {
          queries.push({ targetTitle: title, targetArtist: artist, params: { q: `${title} ${artist}` } });
        }
      }
      queries.push({ targetTitle: cleanCore, targetArtist: artist, params: { track_name: cleanCore } });
      queries.push({ targetTitle: cleanCore, targetArtist: artist, params: { q: cleanCore } });
      if (title !== cleanCore) {
        queries.push({ targetTitle: title, targetArtist: artist, params: { track_name: title } });
      }
    }

    let bestMatch = null;
    let bestScore = -1;
    let detectedTitle = cleanCore || title;
    let detectedArtist = artist;

    for (const q of queries) {
      const candidates = await queryLrclib(q.params);
      for (const c of candidates) {
        const score = scoreCandidate(c, q.targetTitle, q.targetArtist, duration, { versionTag });
        if (score > bestScore) {
          bestScore = score;
          bestMatch = c;
          detectedTitle = c.name || c.trackName || q.targetTitle;
          detectedArtist = c.artistName || q.targetArtist;
        }
      }
      // High-confidence match (e.g. title + artist + duration/synced bonus): terminate early
      if (bestScore >= 160) break;
    }

    if (!bestMatch || bestScore < 40) {
      const emptyResult = {
        synced: false,
        lines: [],
        error: 'No lyrics found for this song.',
        trackName: detectedTitle || cleanCore || title,
        artistName: detectedArtist || artist,
        source: 'lrclib',
      };
      saveSessionLyrics(rawTitle, rawArtist, emptyResult);
      return emptyResult;
    }

    if (bestMatch.instrumental) {
      const rawTrack = bestMatch.name || bestMatch.trackName || detectedTitle || title;
      const instrumentalResult = {
        synced: true,
        instrumental: true,
        lines: [{ time: 0, text: '♪ Instrumental ♪' }],
        trackName: cleanTrackTitle(rawTrack) || rawTrack,
        artistName: bestMatch.artistName || detectedArtist || artist,
        duration: bestMatch.duration,
        source: 'lrclib',
      };
      saveSessionLyrics(rawTitle, rawArtist, instrumentalResult);
      return instrumentalResult;
    }

    if (bestMatch.syncedLyrics) {
      const parsedLrc = parseLRC(bestMatch.syncedLyrics);
      const rawTrack = bestMatch.name || bestMatch.trackName || detectedTitle || title;
      const syncedResult = {
        synced: true,
        lines: parsedLrc,
        raw: bestMatch.syncedLyrics,
        trackName: cleanTrackTitle(rawTrack) || rawTrack,
        artistName: bestMatch.artistName || detectedArtist || artist,
        duration: bestMatch.duration,
        source: 'lrclib',
      };
      saveSessionLyrics(rawTitle, rawArtist, syncedResult);
      return syncedResult;
    }

    if (bestMatch.plainLyrics) {
      const plainLines = bestMatch.plainLyrics
        .split(/\r?\n/)
        .map((text) => ({ time: null, text: text.trim() }))
        .filter((item, idx, arr) => !(item.text === '' && (arr[idx - 1]?.text === '' || idx === 0 || idx === arr.length - 1)));

      const rawTrack = bestMatch.name || bestMatch.trackName || detectedTitle || title;
      const plainResult = {
        synced: false,
        lines: plainLines,
        raw: bestMatch.plainLyrics,
        trackName: cleanTrackTitle(rawTrack) || rawTrack,
        artistName: bestMatch.artistName || detectedArtist || artist,
        duration: bestMatch.duration,
        source: 'lrclib',
      };
      saveSessionLyrics(rawTitle, rawArtist, plainResult);
      return plainResult;
    }

    const emptyResult = {
      synced: false,
      lines: [],
      error: 'No synced or plain lyrics available.',
      trackName: cleanTrackTitle(detectedTitle || cleanCore || title),
      artistName: detectedArtist || artist,
      source: 'lrclib',
    };
    saveSessionLyrics(rawTitle, rawArtist, emptyResult);
    return emptyResult;
  } catch (err) {
    console.error('Error fetching lyrics from LRCLIB:', err);
    return {
      synced: false,
      lines: [],
      error: 'Failed to fetch lyrics.',
      trackName: cleanTrackTitle(title) || title,
      artistName: artist,
      source: 'lrclib',
    };
  }
}

/**
 * Formats a candidate returned from LRCLIB into standard lyricsData structure.
 */
export function formatCandidateResult(candidate) {
  if (!candidate) return null;
  const rawTrack = candidate.name || candidate.trackName || '';
  const trackName = cleanTrackTitle(rawTrack) || rawTrack;
  const artistName = candidate.artistName || '';

  if (candidate.instrumental) {
    return {
      synced: true,
      instrumental: true,
      lines: [{ time: 0, text: '♪ Instrumental ♪' }],
      trackName,
      artistName,
      duration: candidate.duration,
      source: 'lrclib',
    };
  }

  if (candidate.syncedLyrics) {
    return {
      synced: true,
      lines: parseLRC(candidate.syncedLyrics),
      raw: candidate.syncedLyrics,
      trackName,
      artistName,
      duration: candidate.duration,
      source: 'lrclib',
    };
  }

  if (candidate.plainLyrics) {
    return {
      synced: false,
      lines: candidate.plainLyrics.split('\n').map((l) => ({
        time: null,
        text: l.trim(),
      })),
      raw: candidate.plainLyrics,
      trackName,
      artistName,
      duration: candidate.duration,
      source: 'lrclib',
    };
  }

  return {
    synced: false,
    lines: [],
    error: 'No lyrics available for this track.',
    trackName,
    artistName,
    duration: candidate.duration,
    source: 'lrclib',
  };
}

/**
 * Searches LRCLIB for track candidates matching a freeform query.
 */
export async function searchLyrics(query, duration = 0) {
  if (!query || !query.trim()) return [];
  const cleanQ = query.trim();
  const cleaned = cleanTrackTitle(cleanQ);

  const searchQ = cleaned || cleanQ;
  let candidates = await queryLrclib({ q: searchQ });

  if (candidates.length === 0 && cleaned && cleaned !== cleanQ) {
    const more = await queryLrclib({ q: cleanQ });
    candidates = candidates.concat(more);
  }

  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    const id = c.id || `${c.trackName || c.name}_${c.artistName}`;
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(c);
    }
  }

  unique.sort((a, b) => {
    const aWeight = a.syncedLyrics ? 3 : a.plainLyrics ? 2 : a.instrumental ? 1 : 0;
    const bWeight = b.syncedLyrics ? 3 : b.plainLyrics ? 2 : b.instrumental ? 1 : 0;
    if (aWeight !== bWeight) return bWeight - aWeight;

    if (duration > 0 && a.duration > 0 && b.duration > 0) {
      const diffA = Math.abs(a.duration - duration);
      const diffB = Math.abs(b.duration - duration);
      if (Math.abs(diffA - diffB) > 4) {
        return diffA - diffB;
      }
    }
    return 0;
  });

  return unique;
}

/**
 * Manually save or override cached lyrics for a track.
 */
export function setCachedLyrics(rawTitle, rawArtist, lyricsData) {
  saveSessionLyrics(rawTitle, rawArtist, lyricsData);
}

/**
 * Clear the in-memory lyrics cache.
 */
export function clearLyricsCache() {
  lyricsCache.clear();
}

