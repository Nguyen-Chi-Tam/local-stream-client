import { isUnknownArtist } from './mediaUtils.js';

// In-memory cache for parsed lyrics: key -> lyrics result
const lyricsCache = new Map();

/**
 * Remove audio/video file extensions, track numbers, quotes, and common YouTube video tags from a track title.
 * Blacklists terms like "Lyrics", "Lyric", "MP3", "Topic" and video tags.
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
  clean = clean.replace(/\[[^\]]*(?:official|m\/?v|video|audio|lyrics?|mp3|topic|hd|4k|remaster|sub|vietsub|karaoke|visualizer|performance|teaser|live)[^\]]*\]/gi, '');
  clean = clean.replace(/\([^)]*(?:official|m\/?v|video|audio|lyrics?|mp3|topic|hd|4k|remaster|sub|vietsub|karaoke|visualizer|performance|teaser|live)[^)]*\)/gi, '');
  clean = clean.replace(/\s*\([^)]*_(?:\d+K|\d+KB|\d+MB)\)\s*$/i, '');
  clean = clean.replace(/\s*\[[^\]]*(?:kbps|flac|lossless)[^\]]*\]/i, '');
  clean = clean.replace(/\s*\([^)]*(?:kbps|flac|lossless)[^)]*\)/i, '');

  // Strip pipe/dash/slash/bullet video/audio suffixes like "| Official Music Video", "- MV", "// M/V", "• Official MV", "- Lyrics", "| MP3"
  clean = clean.replace(/\s*(?:[|/\\•\-–—~:]\s*)?(?:official\s*(?:music\s*video|m\/?v|video|audio|lyric\s*video)?|m\/?v|music\s*video|lyric\s*video|visualizer|lyrics?|mp3)\s*$/gi, '');

  // Strip blacklisted standalone keywords like "MV", "M/V", "Official Video", "Lyric Video", "Lyrics", "MP3", "Topic"
  clean = clean.replace(/\b(?:official\s*(?:music\s*video|video|audio|m\/?v)?|m\/?v|hd|4k|full\s*hd|lyric\s*video|visualizer|lyrics?|mp3|topic)\b/gi, '');

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

  // Strip blacklisted terms like Lyrics, MP3, and YouTube Music's Topic suffix
  clean = clean.replace(/\b(?:lyrics?|mp3|topic)\b/gi, '');

  // Strip trailing/leading separators and quotes
  clean = clean.replace(/[\s|/\\•\-–—~:]+$/, '');
  clean = clean.replace(/^[\s|/\\•\-–—~:]+/, '');
  clean = clean.replace(/^['"“‘]+|['"”’]+$/g, '');

  return clean.replace(/\s+/g, ' ').trim();
}

export const JUNK_SEGMENT_REGEX = /^(?:official\s*(?:video|audio|music\s*video|mv)?|m\/?v|lyric\s*video|visualizer|audio|full\s*hd|hd|4k|karaoke|vietsub|engsub|lossless|mv\s*hd|lyrics?|mp3|topic|lyrics?\s*mp3|mp3\s*lyrics?|nhạc\s*mp3|nhac\s*mp3)$/i;
export const VERSION_TAG_REGEX = /^(?:special\s*version|acoustic(?:\s*version)?|live(?:\s*performance|\s*version|\s*show|\s*session)?|instrumental|remix|slowed(?:\s*\+\s*reverb)?|speed\s*up|cover|original\s*mix)$/i;

/**
 * Helper to test if a segment is purely junk/blacklisted terms (e.g. "Lyrics Mp3", "Official MV", "Audio").
 */
export function isJunkSegment(seg) {
  if (!seg) return true;
  const s = seg.trim().toLowerCase();
  if (JUNK_SEGMENT_REGEX.test(s)) return true;
  const cleanedWords = s.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
  const junkWords = new Set(['lyrics', 'lyric', 'mp3', 'topic', 'audio', 'video', 'mv', 'hd', '4k', 'official', 'nhac', 'karaoke', 'vietsub', 'full']);
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
        // A known, wholly different artist is meaningful negative evidence. This
        // prevents a common title (or an artist name that is also a song title)
        // from winning solely because LRCLIB returned it first.
        else totalScore -= 30;
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

function scoreFreeformSearchCandidate(candidate, query, duration) {
  const normalizedQuery = normalizeText(query);
  const title = normalizeText(candidate.name || candidate.trackName || '');
  const artist = normalizeText(candidate.artistName || '');
  if (!normalizedQuery || (!title && !artist)) return -1;

  let score = 0;
  if (normalizedQuery === title || normalizedQuery === artist) score = 100;
  else if (title.includes(normalizedQuery) || artist.includes(normalizedQuery)) score = 80;
  else {
    const queryWords = normalizedQuery.split(' ').filter(Boolean);
    const candidateWords = new Set(`${title} ${artist}`.split(' ').filter(Boolean));
    const coverage = queryWords.length
      ? queryWords.filter((word) => candidateWords.has(word)).length / queryWords.length
      : 0;
    score = coverage >= 0.5 ? coverage * 60 : 0;
  }

  if (duration > 0 && candidate.duration > 0) {
    const difference = Math.abs(candidate.duration - duration);
    if (difference <= 5) score += 20;
    else if (difference <= 20) score += 10;
  }
  if (candidate.syncedLyrics) score += 10;
  return score;
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

    // Player metadata is more reliable than a filename convention. In
    // particular, names such as "The Chainsmokers" can legitimately be either
    // a track title or an artist, so do not replace a supplied artist merely
    // because the title contains a divider.
    if (artist) {
      const normalizedArtist = normalizeText(artist);
      const aMatchesArtist = normalizeText(partA).includes(normalizedArtist)
        || normalizedArtist.includes(normalizeText(partA));
      const bMatchesArtist = normalizeText(partB).includes(normalizedArtist)
        || normalizedArtist.includes(normalizeText(partB));

      if (aMatchesArtist && !bMatchesArtist) title = partB;
      else if (bMatchesArtist && !aMatchesArtist) title = partA;
      // If neither (or both) segment matches, retain the complete title. It is
      // safer to search broadly than to guess an orientation.
      return {
        title,
        artist,
        versionTag,
        split: { partA, partB },
        isOrientationUncertain: !aMatchesArtist && !bMatchesArtist,
      };
    }

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
 * Builds lookup hints for filenames that put collaborating artists directly
 * before the song title, without a separator (for example
 * "Đen x JustaTee Đi Về Nhà").
 */
export function inferEmbeddedArtistTitleHints(rawTitle, rawArtist = '') {
  if (rawArtist && !isUnknownArtist(rawArtist)) return [];
  const input = cleanTrackTitle(rawTitle);
  if (!input) return [];

  const collaboration = /\s+(?:x|×|&|feat\.?|ft\.?|featuring|with)\s+/gi;
  let marker;
  let lastMarker;
  while ((marker = collaboration.exec(input)) !== null) {
    lastMarker = marker;
  }
  if (!lastMarker) return [];

  const artistPrefix = input.slice(0, lastMarker.index + lastMarker[0].length).trim();
  const afterCollaboration = input.slice(lastMarker.index + lastMarker[0].length).trim();
  const words = afterCollaboration.split(/\s+/).filter(Boolean);
  if (words.length < 2) return [];

  const hints = [];
  for (let artistWordCount = 1; artistWordCount < words.length; artistWordCount += 1) {
    const artist = `${artistPrefix} ${words.slice(0, artistWordCount).join(' ')}`.trim();
    const title = words.slice(artistWordCount).join(' ');
    if (title.length >= 3) {
      hints.push({ title, artist });
    }
  }
  return hints;
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

function parseTtmlTime(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const match = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) +
    Number(`0.${match[4] || '0'}`);
}

function parseTtmlLyrics(ttml) {
  if (!ttml || typeof DOMParser === 'undefined') return null;
  try {
    const document = new DOMParser().parseFromString(ttml, 'application/xml');
    if (document.querySelector('parsererror')) return null;
    const paragraphs = Array.from(document.querySelectorAll('p'));
    const lines = paragraphs
      .map((paragraph) => {
        const timedSpans = Array.from(paragraph.querySelectorAll('span'));
        const text = (timedSpans.length > 0 ? timedSpans : [paragraph])
          .map((node) => node.textContent?.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join(' ');
        const firstTimedNode = timedSpans[0] || paragraph;
        const time = parseTtmlTime(firstTimedNode.getAttribute('begin') || paragraph.getAttribute('begin'));
        return time == null || !text ? null : { time, text };
      })
      .filter(Boolean);
    return lines.length > 0 ? lines : null;
  } catch (error) {
    console.warn('Failed to parse TTML lyrics:', error);
    return null;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Lyrics provider HTTP ${response.status}`);
  return response.json();
}

async function fetchTtml(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Lyrics provider HTTP ${response.status}`);
  return response.text();
}

function makeTtmlResult(ttml, trackName, artistName, source, duration = 0) {
  const lines = parseTtmlLyrics(ttml);
  if (!lines) return null;
  return {
    synced: true,
    lines,
    raw: ttml,
    trackName: cleanTrackTitle(trackName) || trackName,
    artistName,
    duration,
    source,
  };
}

async function fetchBiniLyrics(title, artist, duration) {
  const url = new URL('https://lyrics-api.binimum.org/');
  url.searchParams.set('track', title);
  url.searchParams.set('artist', artist);
  if (duration > 0) url.searchParams.set('duration', String(Math.round(duration)));
  const data = await fetchJson(url.toString());
  const results = Array.isArray(data.results) ? data.results : [];
  const best = results.find((item) => item.lyricsUrl);
  if (!best) return null;
  const ttml = await fetchTtml(best.lyricsUrl);
  return makeTtmlResult(ttml, best.track_name || title, best.artist_name || artist, 'binilyrics', best.duration);
}

async function fetchLrcRedLyrics(isrc, title, artist, duration) {
  if (!isrc) return null;
  const ttml = await fetchTtml(`https://lrc.red/s/${encodeURIComponent(isrc)}.ttml`);
  return makeTtmlResult(ttml, title, artist, 'lrc.red', duration);
}

async function fetchBetterLyrics(title, artist, duration, provider = '') {
  const basePath = provider ? `/${provider}/getLyrics` : '/getLyrics';
  const url = new URL(`https://api.betterlyrics.org${basePath}`);
  url.searchParams.set('s', title);
  url.searchParams.set('a', artist);
  url.searchParams.set('al', '');
  url.searchParams.set('d', String(Math.round(duration || 0)));
  const data = await fetchJson(url.toString());
  const ttml = data.ttml || data.lyrics;
  return makeTtmlResult(ttml, title, artist, provider ? `betterlyrics-${provider}` : 'betterlyrics', duration);
}

function parseLyricsPlusLines(data) {
  const entries = Array.isArray(data?.lyrics) ? data.lyrics : [];
  const lines = entries
    .map((entry) => {
      const text = String(
        entry?.text || entry?.lyric || entry?.words?.map((word) => word?.text || word).join(' ') || '',
      ).replace(/\s+/g, ' ').trim();
      const time = Number(entry?.time ?? entry?.startTime ?? entry?.start);
      // LyricsPlus timestamps are milliseconds. A small value is retained as
      // seconds so this also supports mirrors that return normalized output.
      const seconds = Number.isFinite(time) ? (time > 1000 ? time / 1000 : time) : null;
      return text && seconds != null ? { time: Math.max(0, seconds), text } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
  return lines.length > 0 ? lines : null;
}

async function fetchLyricsPlus(title, artist, duration, isrc = '') {
  // These public mirrors expose the open-source LyricsPlus API. It searches
  // Apple Music, Musixmatch, Spotify, and QQ Music behind one normalized API.
  const mirrors = [
    'https://lyricsplus.prjktla.my.id',
    'https://lyricsplus.prjktla.workers.dev',
    'https://lyricsplus-seven.vercel.app',
  ];

  for (const baseUrl of mirrors) {
    try {
      const url = new URL('/v2/lyrics/get', baseUrl);
      url.searchParams.set('title', title);
      url.searchParams.set('artist', artist || 'Unknown Artist');
      if (duration > 0) url.searchParams.set('duration', String(Math.round(duration)));
      if (isrc) url.searchParams.set('isrc', isrc);
      url.searchParams.set('source', 'apple,lyricsplus,musixmatch,spotify,qq');

      const data = await fetchJson(url.toString(), {
        headers: { 'Accept': 'application/json' },
      });
      const lines = parseLyricsPlusLines(data);
      if (lines) {
        return {
          synced: true,
          lines,
          raw: JSON.stringify(data),
          trackName: cleanTrackTitle(data?.metadata?.title || title) || title,
          artistName: data?.metadata?.artist || artist,
          duration,
          source: 'lyricsplus',
        };
      }
    } catch (error) {
      console.warn('LyricsPlus mirror lookup failed:', error);
    }
  }
  return null;
}

async function fetchAdditionalLyrics(title, artist, duration, isrc = '') {
  const providers = [
    () => fetchBiniLyrics(title, artist, duration),
    () => fetchLrcRedLyrics(isrc, title, artist, duration),
    () => fetchBetterLyrics(title, artist, duration),
    () => fetchBetterLyrics(title, artist, duration, 'qq'),
    () => fetchBetterLyrics(title, artist, duration, 'kugou'),
    () => fetchLyricsPlus(title, artist, duration, isrc),
  ];

  for (const fetchProvider of providers) {
    try {
      const result = await fetchProvider();
      if (result?.lines?.length) return result;
    } catch (error) {
      console.warn('Lyrics provider lookup failed:', error);
    }
  }
  return null;
}

const musicBrainzCache = new Map();
let musicBrainzLastRequestAt = 0;

function getMusicBrainzArtistName(recording) {
  return (recording['artist-credit'] || [])
    .map((credit) => `${credit.name || credit.artist?.name || ''}${credit.joinphrase || ''}`)
    .filter(Boolean)
    .join('');
}

function scoreMusicBrainzRecording(recording, targetTitle, targetArtist, duration) {
  const title = recording.title || '';
  const artist = getMusicBrainzArtistName(recording);
  const normalizedTargetTitle = normalizeText(targetTitle);
  const normalizedTitle = normalizeText(title);
  const normalizedTargetArtist = normalizeText(targetArtist);
  const normalizedArtist = normalizeText(artist);

  if (!normalizedTargetTitle || !normalizedTitle) return -1;

  let titleScore = 0;
  if (normalizedTitle === normalizedTargetTitle) {
    titleScore = 100;
  } else if (
    normalizedTitle.includes(normalizedTargetTitle) ||
    normalizedTargetTitle.includes(normalizedTitle)
  ) {
    titleScore = 75;
  } else {
    const targetWords = normalizedTargetTitle.split(' ');
    const matchingWords = targetWords.filter((word) => normalizedTitle.split(' ').includes(word));
    titleScore = targetWords.length > 0 ? (matchingWords.length / targetWords.length) * 60 : 0;
  }

  if (titleScore < 60) return -1;

  let totalScore = titleScore;
  if (normalizedTargetArtist && normalizedArtist) {
    if (normalizedTargetArtist === normalizedArtist) {
      totalScore += 70;
    } else if (
      normalizedArtist.includes(normalizedTargetArtist) ||
      normalizedTargetArtist.includes(normalizedArtist)
    ) {
      totalScore += 45;
    } else {
      const targetWords = normalizedTargetArtist.split(' ');
      const matchingWords = targetWords.filter((word) => normalizedArtist.split(' ').includes(word));
      totalScore += targetWords.length > 0 ? (matchingWords.length / targetWords.length) * 30 : 0;
    }
  }

  const recordingDuration = Number(recording.length || 0) / 1000;
  if (duration > 0 && recordingDuration > 0) {
    const difference = Math.abs(recordingDuration - duration);
    if (difference <= 5) totalScore += 30;
    else if (difference <= 15) totalScore += 20;
    else if (difference <= 35) totalScore += 10;
    else if (difference > 60) totalScore -= 30;
  }

  return totalScore;
}

function scoreTitleEvidence(recording, candidateTitle) {
  const normalizedCandidate = normalizeText(candidateTitle);
  const normalizedRecording = normalizeText(recording.title || '');
  if (!normalizedCandidate || !normalizedRecording) return 0;
  if (normalizedCandidate === normalizedRecording) return 100;
  if (normalizedRecording.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedRecording)) {
    return 70;
  }
  return 0;
}

async function resolveSplitByTitleEvidence(partA, partB, duration) {
  const evidence = [];

  for (const possibleTitle of [partA, partB].filter(Boolean)) {
    const recordings = await queryMusicBrainz(
      `recording:"${possibleTitle.replace(/"/g, '\\"')}"`,
    );
    const scored = recordings
      .map((recording) => ({
        recording,
        titleScore: scoreTitleEvidence(recording, possibleTitle),
      }))
      .filter((item) => item.titleScore > 0)
      .sort((a, b) => b.titleScore - a.titleScore);

    if (scored.length === 0) continue;

    const best = scored[0];
    const distinctTitles = new Set(
      scored.map((item) => normalizeText(item.recording.title || '')),
    ).size;
    const durationSeconds = Number(best.recording.length || 0) / 1000;
    const durationDifference = duration > 0 && durationSeconds > 0
      ? Math.abs(durationSeconds - duration)
      : 0;
    const durationScore = durationDifference <= 5 ? 30 : durationDifference <= 35 ? 10 : 0;

    evidence.push({
      recording: best.recording,
      score: best.titleScore
        + (distinctTitles <= 2 ? 15 : 0)
        + durationScore
        - Math.min(scored.length, 10) * 3,
      resultCount: scored.length,
      distinctTitles,
    });
  }

  evidence.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.distinctTitles !== b.distinctTitles) return a.distinctTitles - b.distinctTitles;
    return a.resultCount - b.resultCount;
  });

  const best = evidence[0];
  const runnerUp = evidence[1];
  if (!best || (runnerUp && best.score - runnerUp.score < 10)) return null;

  return {
    title: best.recording.title,
    artist: getMusicBrainzArtistName(best.recording),
    mbid: best.recording.id,
    isrc: best.recording.isrcs?.[0] || '',
    duration: Number(best.recording.length || 0) / 1000,
    source: 'musicbrainz',
  };
}

async function waitForMusicBrainzRateLimit() {
  const waitMs = Math.max(0, 1000 - (Date.now() - musicBrainzLastRequestAt));
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  musicBrainzLastRequestAt = Date.now();
}

async function queryMusicBrainz(query) {
  const cacheKey = query.trim().toLowerCase();
  if (!cacheKey) return [];
  if (musicBrainzCache.has(cacheKey)) return musicBrainzCache.get(cacheKey);

  try {
    await waitForMusicBrainzRateLimit();
    const url = new URL('https://musicbrainz.org/ws/2/recording');
    url.searchParams.set('query', query);
    url.searchParams.set('fmt', 'json');
    url.searchParams.set('limit', '10');
    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`MusicBrainz HTTP ${response.status}`);
    }
    const data = await response.json();
    const recordings = Array.isArray(data.recordings) ? data.recordings : [];
    musicBrainzCache.set(cacheKey, recordings);
    return recordings;
  } catch (error) {
    console.warn('MusicBrainz lookup failed:', error);
    return [];
  }
}

/**
 * Resolves an uncertain filename split against MusicBrainz.
 * A split is only accepted when both title/artist evidence and (when present)
 * recording duration support the same recording.
 */
async function resolveWithMusicBrainz(rawTitle, rawArtist, duration, parsed) {
  // Never use filename inference to replace artist metadata supplied by the
  // player. It is exactly the ambiguous case this resolver cannot prove.
  if (rawArtist && !isUnknownArtist(rawArtist)) return null;

  if (!parsed.isOrientationUncertain || !parsed.split) {
    const recordings = await queryMusicBrainz(rawTitle);
    const normalizedRaw = normalizeText(rawTitle);
    const directMatches = recordings
      .map((recording) => {
        const title = recording.title || '';
        const artist = getMusicBrainzArtistName(recording);
        const titleWords = normalizeText(title).split(' ').filter(Boolean);
        const artistWords = normalizeText(artist).split(' ').filter(Boolean);
        const titleMatches = titleWords.filter((word) => normalizedRaw.includes(word)).length;
        const artistMatches = artistWords.filter((word) => normalizedRaw.includes(word)).length;
        const coverage = titleWords.length + artistWords.length > 0
          ? (titleMatches + artistMatches) / (titleWords.length + artistWords.length)
          : 0;
        const durationSeconds = Number(recording.length || 0) / 1000;
        const durationDifference = duration > 0 && durationSeconds > 0
          ? Math.abs(durationSeconds - duration)
          : 0;
        const durationScore = durationDifference <= 5 ? 30 : durationDifference <= 35 ? 10 : durationDifference > 60 ? -30 : 0;
        return {
          recording,
          score: (Number(recording.score) || 0) + coverage * 100 + durationScore,
          coverage,
        };
      })
      .filter((match) => match.coverage >= 0.6)
      .sort((a, b) => b.score - a.score);

    const bestDirect = directMatches[0];
    if (bestDirect && bestDirect.score >= 150) {
      return {
        title: bestDirect.recording.title,
        artist: getMusicBrainzArtistName(bestDirect.recording),
        mbid: bestDirect.recording.id,
        isrc: bestDirect.recording.isrcs?.[0] || '',
        duration: Number(bestDirect.recording.length || 0) / 1000,
        source: 'musicbrainz',
      };
    }
    return null;
  }

  const splitEvidenceMatch = await resolveSplitByTitleEvidence(
    parsed.split.partA,
    parsed.split.partB,
    duration,
  );
  if (splitEvidenceMatch) return splitEvidenceMatch;

  const possiblePairs = [
    { title: parsed.split.partA, artist: parsed.split.partB },
    { title: parsed.split.partB, artist: parsed.split.partA },
  ];
  const scored = [];

  for (const pair of possiblePairs) {
    const query = `recording:"${pair.title.replace(/"/g, '\\"')}" AND artist:"${pair.artist.replace(/"/g, '\\"')}"`;
    let recordings = await queryMusicBrainz(query);
    if (recordings.length === 0) {
      recordings = await queryMusicBrainz(`recording:"${pair.title.replace(/"/g, '\\"')}"`);
    }
    for (const recording of recordings) {
      const score = scoreMusicBrainzRecording(recording, pair.title, pair.artist, duration);
      if (score >= 0) {
        scored.push({
          score,
          title: recording.title,
          artist: getMusicBrainzArtistName(recording),
          mbid: recording.id,
          isrc: recording.isrcs?.[0] || '',
          duration: Number(recording.length || 0) / 1000,
        });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || best.score < 100 || (runnerUp && best.score - runnerUp.score < 15)) {
    return null;
  }

  return {
    title: best.title,
    artist: best.artist,
    mbid: best.mbid,
    isrc: best.isrc,
    duration: best.duration,
    source: 'musicbrainz',
  };
}

const SESSION_CACHE_PREFIX = 'local_stream_lyrics_session_';
const SELECTED_LYRICS_PREFIX = 'local_stream_lyrics_selected_';

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

function hasUsableLyrics(candidate) {
  return Boolean(
    candidate &&
    (
      candidate.instrumental ||
      (Array.isArray(candidate.lines) && candidate.lines.length > 0) ||
      (typeof candidate.syncedLyrics === 'string' && candidate.syncedLyrics.trim()) ||
      (typeof candidate.plainLyrics === 'string' && candidate.plainLyrics.trim())
    )
  );
}

/**
 * Saves a track's lyrics to memory and browser sessionStorage for the session.
 */
export function saveSessionLyrics(rawTitle, rawArtist = '', lyricsData) {
  if (!rawTitle || !hasUsableLyrics(lyricsData)) return;
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
      const cached = lyricsCache.get(k);
      if (hasUsableLyrics(cached)) return cached;
      lyricsCache.delete(k);
    }
  }

  // 2. Check browser sessionStorage
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      for (const k of keys) {
        const stored = window.sessionStorage.getItem(SESSION_CACHE_PREFIX + k);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (hasUsableLyrics(parsed)) {
            lyricsCache.set(k, parsed);
            return parsed;
          }
          window.sessionStorage.removeItem(SESSION_CACHE_PREFIX + k);
        }
      }
    }
  } catch {
    // Storage error
  }

  return null;
}

/**
 * Persists an explicitly selected lyric result while connected to the current
 * server. The entries are cleared when the server is disconnected.
 */
export function saveSelectedLyrics(rawTitle, rawArtist = '', lyricsData) {
  if (!rawTitle || !hasUsableLyrics(lyricsData)) return;
  const keys = getLookupKeys(rawTitle, rawArtist);

  for (const key of keys) {
    lyricsCache.set(key, lyricsData);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(SELECTED_LYRICS_PREFIX + key, JSON.stringify(lyricsData));
      }
    } catch (error) {
      console.warn('Unable to persist selected lyrics:', error);
    }
  }
}

/**
 * Retrieves an explicitly selected lyric result persisted in localStorage.
 */
export function getSelectedLyrics(rawTitle, rawArtist = '') {
  if (!rawTitle) return null;
  const keys = getLookupKeys(rawTitle, rawArtist);

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      for (const key of keys) {
        const stored = window.localStorage.getItem(SELECTED_LYRICS_PREFIX + key);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (hasUsableLyrics(parsed)) {
            lyricsCache.set(key, parsed);
            return parsed;
          }
          window.localStorage.removeItem(SELECTED_LYRICS_PREFIX + key);
        }
      }
    }
  } catch (error) {
    console.warn('Unable to read selected lyrics:', error);
  }

  return null;
}

/**
 * Clears user-selected lyric overrides when the current server is disconnected.
 */
export function clearSelectedLyrics() {
  lyricsCache.clear();
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const keysToRemove = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(SELECTED_LYRICS_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => window.localStorage.removeItem(key));
    }
  } catch (error) {
    console.warn('Unable to clear selected lyrics:', error);
  }
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
  let { title, artist, versionTag, split, isOrientationUncertain } = parsed;
  if (!title) return null;

  if (!forceRefresh) {
    const selectedLyrics = getSelectedLyrics(rawTitle, rawArtist);
    if (selectedLyrics) {
      return selectedLyrics;
    }

    const sessionCached = getSessionLyrics(rawTitle, rawArtist);
    if (sessionCached && hasUsableLyrics(sessionCached)) {
      return sessionCached;
    }
  }

  try {
    const musicBrainzMatch = await resolveWithMusicBrainz(rawTitle, rawArtist, duration, parsed);
    if (musicBrainzMatch) {
      title = musicBrainzMatch.title;
      artist = musicBrainzMatch.artist;
      split = null;
      isOrientationUncertain = false;
    }

    const cleanCore = stripExtraTitleDetails(title);
    const queries = [];
    const embeddedHints = inferEmbeddedArtistTitleHints(rawTitle, rawArtist);

    for (const hint of embeddedHints) {
      const hintTitle = stripExtraTitleDetails(hint.title);
      const hintArtist = stripExtraTitleDetails(hint.artist);
      queries.push({
        targetTitle: hintTitle,
        targetArtist: hintArtist,
        params: { track_name: hintTitle, artist_name: hintArtist },
      });
      queries.push({
        targetTitle: hintTitle,
        targetArtist: hintArtist,
        params: { q: `${hintTitle} ${hintArtist}` },
      });
      queries.push({
        targetTitle: hintTitle,
        targetArtist: hintArtist,
        params: { track_name: hintTitle },
      });
    }

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

    const uniqueQueries = [];
    const queryKeys = new Set();
    for (const query of queries) {
      const key = JSON.stringify(query.params);
      if (!queryKeys.has(key)) {
        queryKeys.add(key);
        uniqueQueries.push(query);
      }
    }

    let firstMatch = null;
    let detectedTitle = cleanCore || title;
    let detectedArtist = artist;
    let bestScore = -1;
    const candidatesById = new Map();

    for (const q of uniqueQueries) {
      const candidates = await queryLrclib(q.params);
      for (const candidate of candidates) {
        if (!(candidate.instrumental || candidate.syncedLyrics || candidate.plainLyrics)) continue;

        const candidateId = candidate.id || `${candidate.name || candidate.trackName || ''}__${candidate.artistName || ''}__${candidate.duration || ''}`;
        const previous = candidatesById.get(candidateId);
        const score = scoreCandidate(candidate, q.targetTitle, q.targetArtist, duration, { versionTag });
        if (!previous || score > previous.score) {
          candidatesById.set(candidateId, { candidate, score, query: q });
        }
      }
    }

    for (const { candidate, score, query } of candidatesById.values()) {
      if (score > bestScore) {
        firstMatch = candidate;
        bestScore = score;
        detectedTitle = candidate.name || candidate.trackName || query.targetTitle;
        detectedArtist = candidate.artistName || query.targetArtist;
      }
    }

    // Do not silently show lyrics for a different song. With an artist we need
    // strong evidence from both fields; title-only lookups can accept an exact
    // title, but remain deliberately more conservative for fuzzy matches.
    const minimumAutoMatchScore = artist ? 125 : 90;
    if (bestScore < minimumAutoMatchScore) {
      firstMatch = null;
    }

    if (!firstMatch) {
      const additionalLyrics = await fetchAdditionalLyrics(
        cleanCore || title,
        artist,
        duration,
        musicBrainzMatch?.isrc || '',
      );
      if (additionalLyrics) {
        saveSessionLyrics(rawTitle, rawArtist, {
          ...additionalLyrics,
          musicBrainzId: musicBrainzMatch?.mbid,
        });
        return {
          ...additionalLyrics,
          musicBrainzId: musicBrainzMatch?.mbid,
        };
      }

      const emptyResult = {
        synced: false,
        lines: [],
        error: 'No lyrics found for this song.',
        trackName: detectedTitle || cleanCore || title,
        artistName: detectedArtist || artist,
        source: 'lrclib',
        musicBrainzId: musicBrainzMatch?.mbid,
      };
      return emptyResult;
    }

    if (firstMatch.instrumental) {
      const rawTrack = firstMatch.name || firstMatch.trackName || detectedTitle || title;
      const instrumentalResult = {
        synced: true,
        instrumental: true,
        lines: [{ time: 0, text: '♪ Instrumental ♪' }],
        trackName: cleanTrackTitle(rawTrack) || rawTrack,
        artistName: firstMatch.artistName || detectedArtist || artist,
        duration: firstMatch.duration,
        source: 'lrclib',
        musicBrainzId: musicBrainzMatch?.mbid,
      };
      saveSessionLyrics(rawTitle, rawArtist, instrumentalResult);
      return instrumentalResult;
    }

    if (firstMatch.syncedLyrics) {
      const parsedLrc = parseLRC(firstMatch.syncedLyrics);
      const rawTrack = firstMatch.name || firstMatch.trackName || detectedTitle || title;
      const syncedResult = {
        synced: true,
        lines: parsedLrc,
        raw: firstMatch.syncedLyrics,
        trackName: cleanTrackTitle(rawTrack) || rawTrack,
        artistName: firstMatch.artistName || detectedArtist || artist,
        duration: firstMatch.duration,
        source: 'lrclib',
        musicBrainzId: musicBrainzMatch?.mbid,
      };
      saveSessionLyrics(rawTitle, rawArtist, syncedResult);
      return syncedResult;
    }

    if (firstMatch.plainLyrics) {
      const plainLines = firstMatch.plainLyrics
        .split(/\r?\n/)
        .map((text) => ({ time: null, text: text.trim() }))
        .filter((item, idx, arr) => !(item.text === '' && (arr[idx - 1]?.text === '' || idx === 0 || idx === arr.length - 1)));

      const rawTrack = firstMatch.name || firstMatch.trackName || detectedTitle || title;
      const plainResult = {
        synced: false,
        lines: plainLines,
        raw: firstMatch.plainLyrics,
        trackName: cleanTrackTitle(rawTrack) || rawTrack,
        artistName: firstMatch.artistName || detectedArtist || artist,
        duration: firstMatch.duration,
        source: 'lrclib',
        musicBrainzId: musicBrainzMatch?.mbid,
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
      musicBrainzId: musicBrainzMatch?.mbid,
    };
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

function getManualSearchTitleVariants(query) {
  const variants = new Set();
  const add = (value) => {
    const cleaned = cleanTrackTitle(value || '');
    if (cleaned) variants.add(cleaned);
  };

  const cleanedQuery = cleanTrackTitle(query);
  add(cleanedQuery);

  const parsed = parseTrackAndArtist(query, '');
  add(parsed.title);
  add(parsed.artist);

  // A pasted label commonly looks like "Artist A x Artist B - Song Title".
  // Search each meaningful segment, especially the final segment, so users do
  // not have to erase collaborators before a title-only catalog lookup works.
  const { segments } = extractSegments(query);
  segments.forEach(add);
  if (segments.length > 1) add(segments[segments.length - 1]);

  return [...variants];
}

/**
 * Searches LRCLIB for track candidates matching a freeform query. Full labels
 * and title-only variants are queried together, then locally ranked.
 */
export async function searchLyrics(query, duration = 0) {
  if (!query || !query.trim()) return [];
  const cleanQ = query.trim();
  const cleaned = cleanTrackTitle(cleanQ);
  const titleVariants = getManualSearchTitleVariants(cleanQ);

  // Ask LRCLIB with the full phrase and every title-focused variant. The server
  // is lexical rather than semantic, so result quality comes from local ranking
  // instead of trusting its response order.
  let candidates = await queryLrclib({ q: cleanQ });

  if (candidates.length === 0 && cleaned && cleaned !== cleanQ) {
    const more = await queryLrclib({ q: cleaned });
    candidates = candidates.concat(more);
  }

  const parsed = parseTrackAndArtist(cleanQ, '');
  // Structured searches supplement the free-text endpoint. They are useful
  // when a query contains artist credits or punctuation that prevents LRCLIB's
  // lexical search from finding an otherwise relevant recording.
  const supplementalQueries = [
    ...titleVariants.flatMap((title) => [
      { track_name: title },
      { q: title },
    ]),
    { artist_name: cleanQ },
  ].filter(Boolean);
  for (const params of supplementalQueries) {
    const more = await queryLrclib(params);
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

  const rankingTargets = [
    { title: cleanQ, artist: '' },
    { title: parsed.title, artist: parsed.artist },
    ...titleVariants.map((title) => ({ title, artist: '' })),
  ].filter((target) => target.title);

  return unique
    .map((candidate, index) => ({
      candidate,
      index,
      score: Math.max(
        scoreFreeformSearchCandidate(candidate, cleanQ, duration),
        ...rankingTargets.map((target) =>
          scoreCandidate(candidate, target.title, target.artist, duration, { versionTag: parsed.versionTag }),
        ),
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ candidate }) => candidate);
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
