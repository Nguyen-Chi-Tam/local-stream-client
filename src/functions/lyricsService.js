import { isUnknownArtist } from './mediaUtils.js';
import { isSemanticSearchReady } from './semanticState.js';

// In-memory cache for parsed lyrics: key -> lyrics result
const lyricsCache = new Map();
// LRU cache for manual-search shortlists. Kept per app session so repeated
// queries and backspacing do not hit LRCLIB again.
const searchResultCache = new Map();
export const MIN_LYRICS_DURATION_SECONDS = 90;
const LYRICS_SEARCH_TIMEOUT_MS = 30000;
import {
  JUNK_BRACKET_WORDS,
  JUNK_ROUND_BRACKET_REGEX,
  JUNK_SEGMENT_REGEX,
  JUNK_SQUARE_BRACKET_REGEX,
  VERSION_TAG_REGEX,
  cleanTrackTitle,
  stripExtraTitleDetails,
  isJunkSegment,
  normalizeText,
  isUploaderLikeArtist,
  tokenizeNormalized,
  LOW_SIGNAL_TOKENS,
  TITLE_SIGNAL_WORDS,
  UPLOADER_ARTIST_WORDS,
  countTitleSignalWords,
  inferOrientationFromTitleLanguage,
  stripRedundantArtistSegments,
  isWordChar,
  removeBracketGroups,
  splitCreditParts,
  findBracketVersionTag,
  extractQuoteCredit,
  extractTitleBesideArtist,
  getCandidateTitle,
  levenshteinDistance,
  stringSimilarity,
  fuzzyTokenSimilarity,
  MIN_FUZZY_TOKEN_LENGTH,
  MIN_FUZZY_TOKEN_SIMILARITY,
  createIdfWeightFn,
  createTokenInvertedIndex,
  weightedTokenCoverage,
  searchTitleDominance,
  scoreFreeformSearchCandidate,
  scoreCandidate,
  scoreSearchCandidate,
  scoreLyricsCandidates,
} from './lyricsSearchEngine.js';
export {
  cleanTrackTitle,
  stripExtraTitleDetails,
  isJunkSegment,
  normalizeText,
  isUploaderLikeArtist,
  tokenizeNormalized,
  stringSimilarity,
  scoreCandidate,
  getCandidateTitle,
  weightedTokenCoverage,
  createIdfWeightFn,
  scoreFreeformSearchCandidate,
  scoreSearchCandidate,
  createTokenInvertedIndex,
  levenshteinDistance,
  fuzzyTokenSimilarity,
} from './lyricsSearchEngine.js';

// Lazy Web Worker owning the pure lexical scoring pipeline. Created on first
// search so the worker bundle stays out of the initial renderer payload.
let lyricsSearchWorker = null;

function getLyricsSearchWorker() {
  if (lyricsSearchWorker === null) {
    lyricsSearchWorker = new Worker(new URL('./lyricsSearchWorker.js', import.meta.url), { type: 'module' });
  }
  return lyricsSearchWorker;
}

function scoreCandidatesInWorker({ candidates, query, duration, targets }) {
  return new Promise((resolve, reject) => {
    const worker = getLyricsSearchWorker();
    const handleMessage = (event) => {
      cleanup();
      resolve(event.data?.entries || []);
    };
    const handleError = () => {
      cleanup();
      reject(new Error('Lyrics search scoring worker failed'));
    };
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Lyrics search scoring worker timed out'));
    }, LYRICS_SEARCH_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
    };
    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);
    worker.postMessage({ candidates, query, duration, targets });
  });
}

/**
 * Splits a title into meaningful segments, extracting version tags and removing video junk tags.
 */
export function extractSegments(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return { segments: [], versionTag: null };
  let input = rawTitle.trim();

  // Remove junk bracket groups before splitting: their content may contain
  // separators ("Waiting For You (Album 22 - Track No.10)") that would
  // otherwise tear the title apart at the dash inside the bracket.
  input = input.replace(JUNK_SQUARE_BRACKET_REGEX, '');
  input = input.replace(JUNK_ROUND_BRACKET_REGEX, '');
  input = input.replace(/\s*\[[^\]]*(?:kbps|flac|lossless)[^\]]*\]/i, '');
  input = input.replace(/\s*\([^)]*(?:kbps|flac|lossless)[^)]*\)/i, '');

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
    if (!versionTag) {
      // A version tag inside brackets ("(Acoustic Version)") stays attached to
      // the title but still targets the versioned query.
      const bracketVersion = findBracketVersionTag(seg);
      if (bracketVersion) versionTag = bracketVersion;
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

// "Album 22", "Track No.10", "Track 5" — listing text that some taggers append
// after song titles. Real artist names never carry it.
const ALBUM_TRACK_LISTING_REGEX = /\b(?:album|track)\b\s*(?:no\.?|#|number\s*)?\s*\d+/i;

/**
 * Extract clean track title and artist, handling dividers, version tags, and detecting Title vs Artist.
 */
export function parseTrackAndArtist(rawTitle, rawArtist) {
  // Some taggers put the song title and its album/track listing in the artist
  // field while the title field holds only the singer
  // ("MONO" / "Waiting For You (Album 22 - Track No.10)"). The listing is the
  // tell — swap the pair so the real title drives the lookup.
  if (
    rawArtist
    && ALBUM_TRACK_LISTING_REGEX.test(rawArtist)
    && !ALBUM_TRACK_LISTING_REGEX.test(rawTitle)
    && tokenizeNormalized(rawTitle).length <= 3
  ) {
    [rawTitle, rawArtist] = [rawArtist, rawTitle];
  }

  const { segments, versionTag } = extractSegments(rawTitle);
  let title = cleanTrackTitle(rawTitle);
  let artist = (rawArtist || '').trim();

  if (isUnknownArtist(artist) || isUploaderLikeArtist(artist)) {
    artist = '';
  }

  // YouTube-style quote credits ("BTS 'Hooligan'") beat dash conventions: the
  // quoted span is the song title, the leading text the channel's phrasing of
  // the artist. Only trusted when what follows the quote is junk, a channel
  // name, a version tag, or empty.
  const quoteCredit = extractQuoteCredit(rawTitle);
  if (quoteCredit) {
    const quotedTitle = cleanTrackTitle(quoteCredit.title);
    if (quotedTitle && !isJunkSegment(quotedTitle)) {
      const quoteArtist = cleanTrackTitle(
        removeBracketGroups(quoteCredit.artist).replace(/\s*\b(?:feat|ft|featuring|with)\.?\s+.*$/i, ''),
      );
      const usableQuoteArtist = quoteArtist && !isUnknownArtist(quoteArtist) && !isUploaderLikeArtist(quoteArtist)
        ? quoteArtist
        : '';
      return {
        title: quotedTitle,
        artist: artist || usableQuoteArtist,
        versionTag: versionTag || quoteCredit.versionTag,
        split: null,
        isOrientationUncertain: false,
      };
    }
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

      if (aMatchesArtist && !bMatchesArtist) {
        // partA may pair the real title WITH the artist ("Title - Artist");
        // only take partB verbatim when partA really is just the artist.
        title = extractTitleBesideArtist(partA, artist) || partB;
      } else if (bMatchesArtist && !aMatchesArtist) {
        title = extractTitleBesideArtist(partB, artist) || partA;
      } else if (!aMatchesArtist && !bMatchesArtist) {
        // Known artist, unknown orientation: a channel/brand side is never the
        // song, so prefer the other side when exactly one looks like a brand.
        const aLooksLikeBrand = isUploaderLikeArtist(partA);
        const bLooksLikeBrand = isUploaderLikeArtist(partB);
        if (aLooksLikeBrand !== bLooksLikeBrand) {
          title = aLooksLikeBrand ? partB : partA;
        }
      }
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
      // No metadata to anchor the orientation. Channel/brand names are never
      // the song (or the artist), so handle those first. Otherwise untagged
      // media labels are overwhelmingly "Artist - Title"; use that default
      // only when title-language evidence does not point the other way.
      const aLooksLikeBrand = isUploaderLikeArtist(partA);
      const bLooksLikeBrand = isUploaderLikeArtist(partB);
      if (aLooksLikeBrand && !bLooksLikeBrand) {
        title = partB;
        artist = '';
      } else if (bLooksLikeBrand && !aLooksLikeBrand) {
        title = partA;
        artist = '';
      } else {
        const inferred = inferOrientationFromTitleLanguage(partA, partB);
        if (inferred) {
          title = inferred.title;
          artist = isUploaderLikeArtist(inferred.artist) ? '' : inferred.artist;
        } else if (!aLooksLikeBrand && !bLooksLikeBrand) {
          // "Rick Astley - Hopelessly", "Queen - Bohemian Rhapsody": a
          // one-word title has no title-language signal, but the label still
          // follows the usual artist-first file convention.
          title = partB;
          artist = partA;
        } else {
          title = partA;
          artist = bLooksLikeBrand ? '' : partB;
        }
      }
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

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Lyrics request aborted');
  error.name = 'AbortError';
  throw error;
}

/**
 * Helper to query LRCLIB search endpoint with given params.
 */
async function queryLrclib(params, retryDelays = [600, 1400], signal = null) {
  throwIfAborted(signal);
  const url = new URL('https://lrclib.net/api/search');
  for (const [key, val] of Object.entries(params)) {
    if (val) url.searchParams.append(key, val);
  }

  // LRCLIB load-sheds bursts of searches with 429/503 (and an occasional
  // network hiccup). Without retries a burst's outcome is a lottery: whichever
  // query slips through decides the result. Spaced retries make the run
  // deterministic. The first, optional title+artist probe passes [] so a rate
  // limit fails over immediately to the full-text query.
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      const res = await fetch(url.toString(), {
        headers: { 'Accept': 'application/json' },
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      }
      // Other 4xx responses are not transient — fail fast.
      if (res.status !== 429 && res.status < 500) return [];
    } catch (error) {
      // A cancelled/timeout request must not be retried.
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      // Network error: retry below.
    }
    if (attempt < retryDelays.length) {
      await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
      throwIfAborted(signal);
    }
  }
  throwIfAborted(signal);
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

// Some providers (notably lrc.red for Vietnamese catalogue entries) swap
// letters for lookalike Unicode characters to dodge copyright matching
// ("Cuộc" → "Ϲuộc", "Người" → "Ɲgười", "Hãy" → "Hãу"). Map them back when
// the document declares Vietnamese — gated on the language tag so genuine
// Cyrillic/Greek lyrics are never rewritten.
const VIETNAMESE_CONFUSABLES = new Map(Object.entries({
  'у': 'y', 'У': 'Y',
  'Ϲ': 'C', 'ϲ': 'c',
  'Ɗ': 'D', 'ɗ': 'd',
  'Ɲ': 'N', 'ɲ': 'n',
  'ɡ': 'g', 'ʟ': 'l',
  'ν': 'v', 'ϳ': 'j',
  'а': 'a', 'А': 'A', 'е': 'e', 'Е': 'E', 'о': 'o', 'О': 'O',
  'р': 'p', 'Р': 'P', 'с': 'c', 'С': 'C', 'х': 'x', 'Х': 'X',
  'ѕ': 's', 'Ѕ': 'S', 'і': 'i', 'І': 'I', 'ј': 'j', 'Ј': 'J', 'ԁ': 'd',
}));

function normalizeConfusableText(text) {
  let output = '';
  for (const char of text) {
    output += VIETNAMESE_CONFUSABLES.get(char) || char;
  }
  return output;
}

function parseTtmlLyrics(ttml) {
  if (!ttml || typeof DOMParser === 'undefined') return null;
  try {
    const document = new DOMParser().parseFromString(ttml, 'application/xml');
    if (document.querySelector('parsererror')) return null;
    const language = (document.documentElement?.getAttribute('xml:lang') || '').toLowerCase();
    const normalizeLine = language.startsWith('vi') ? normalizeConfusableText : (value) => value;
    const paragraphs = Array.from(document.querySelectorAll('p'));
    const lines = paragraphs
      .map((paragraph) => {
        const timedSpans = Array.from(paragraph.querySelectorAll('span'));
        const rawText = (timedSpans.length > 0 ? timedSpans : [paragraph])
          .map((node) => node.textContent?.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join(' ');
        const text = normalizeLine(rawText);
        const firstTimedNode = timedSpans[0] || paragraph;
        const time = parseTtmlTime(firstTimedNode.getAttribute('begin') || paragraph.getAttribute('begin'));
        // Some providers (lrc.red ships songs with timing="None") deliver the
        // correct lyrics without timestamps — keep them as plain lines rather
        // than discarding the whole result.
        return !text ? null : { time, text };
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

async function fetchTtml(url, signal = null) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Lyrics provider HTTP ${response.status}`);
  return response.text();
}

function makeTtmlResult(ttml, trackName, artistName, source, duration = 0) {
  const lines = parseTtmlLyrics(ttml);
  if (!lines) return null;
  return {
    synced: lines.some((line) => line.time != null),
    lines,
    raw: ttml,
    trackName: cleanTrackTitle(trackName) || trackName,
    artistName,
    duration,
    source,
  };
}

async function fetchBiniLyrics(title, artist, duration, signal = null) {
  const url = new URL('https://lyrics-api.binimum.org/');
  url.searchParams.set('track', title);
  url.searchParams.set('artist', artist);
  if (duration > 0) url.searchParams.set('duration', String(Math.round(duration)));
  const data = await fetchJson(url.toString(), { signal });
  const results = Array.isArray(data.results) ? data.results : [];
  const best = results.find((item) => item.lyricsUrl);
  if (!best) return null;
  const ttml = await fetchTtml(best.lyricsUrl, signal);
  return makeTtmlResult(ttml, best.track_name || title, best.artist_name || artist, 'binilyrics', best.duration);
}

async function fetchLrcRedLyrics(isrc, title, artist, duration, signal = null) {
  if (!isrc) return null;
  const ttml = await fetchTtml(`https://lrc.red/s/${encodeURIComponent(isrc)}.ttml`, signal);
  return makeTtmlResult(ttml, title, artist, 'lrc.red', duration);
}

async function fetchBetterLyrics(title, artist, duration, provider = '', signal = null) {
  const basePath = provider ? `/${provider}/getLyrics` : '/getLyrics';
  const url = new URL(`https://api.betterlyrics.org${basePath}`);
  url.searchParams.set('s', title);
  url.searchParams.set('a', artist);
  url.searchParams.set('al', '');
  url.searchParams.set('d', String(Math.round(duration || 0)));
  const data = await fetchJson(url.toString(), { signal });
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

async function fetchLyricsPlus(title, artist, duration, isrc = '', signal = null) {
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
        signal,
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
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      console.warn('LyricsPlus mirror lookup failed:', error);
    }
  }
  return null;
}

// ── YouTube Music (Innertube) ────────────────────────────────────────────────
// The web client only exposes plain text, but the Android Music client returns
// `timedLyricsModel.lyricsData.timedLyricsData`, where every row carries a
// `cueRange` in milliseconds. This mirrors ytmusicapi's
// get_lyrics(timestamps=True): search → next (WEB_REMIX, resolves the MPLYt…
// browse id) → browse (ANDROID_MUSIC, returns the cue ranges).
// Only fully timed payloads are accepted. Plain YTM lyrics are ignored so this
// provider can never preempt a timed result from a later mirror.
const YTM_API_ORIGIN = 'https://music.youtube.com';
const YTM_WEB_CLIENT_VERSION = '1.20261026.01.00';
const YTM_ANDROID_CLIENT_VERSION = '7.21.50';
// "Songs" search filter used by the YouTube Music web client.
const YTM_SONG_SEARCH_PARAMS = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';
const YTM_REQUEST_TIMEOUT_MS = 12000;
const YTM_CACHE_TTL_MS = 10 * 60 * 1000;
const YTM_CACHE_MAX_ENTRIES = 40;
// Optional CORS relay whose base maps to https://music.youtube.com/youtubei/v1.
// The desktop build uses Electron IPC instead, and `npm run dev` uses the Vite
// proxy configured in vite.config.mjs.
const YTM_PROXY_BASE = String(import.meta.env.VITE_YTM_PROXY || '').replace(/\/+$/, '');
const YTM_USE_DEV_PROXY = Boolean(import.meta.env.DEV);
const ytmCache = new Map();
let ytmDirectFetchBlocked = false;

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function collectNodesByKey(root, key, limit = Infinity) {
  const output = [];
  if (!root || typeof root !== 'object') return output;
  const stack = [root];
  while (stack.length > 0 && output.length < limit) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (let index = node.length - 1; index >= 0; index -= 1) stack.push(node[index]);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(node, key)) output.push(node[key]);
    const values = Object.values(node);
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const value = values[index];
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return output;
}

function ytmContext(clientName, clientVersion, extra = {}) {
  return {
    context: {
      client: {
        clientName,
        clientVersion,
        hl: 'en',
        gl: 'US',
        ...extra,
      },
    },
  };
}

function ytmApiUrl(path) {
  const base = YTM_PROXY_BASE
    || (YTM_USE_DEV_PROXY ? '/__ytmusic/youtubei/v1' : `${YTM_API_ORIGIN}/youtubei/v1`);
  return `${base}/${path}?prettyPrint=false`;
}

async function ytmRequest(path, body, signal) {
  const bridge = typeof window !== 'undefined' ? window.electronLyrics : null;
  if (bridge?.innertube) {
    try {
      return await withTimeout(
        bridge.innertube({ path, body }),
        YTM_REQUEST_TIMEOUT_MS,
        'YouTube Music request',
      );
    } catch (error) {
      if (signal?.aborted) throwIfAborted(signal);
      throw error;
    }
  }

  // Innertube rejects browser requests carrying a foreign Origin header, so a
  // hosted web build cannot read these responses directly. Bail out quietly
  // once that has been established instead of retrying every lookup.
  if (!YTM_PROXY_BASE && !YTM_USE_DEV_PROXY && ytmDirectFetchBlocked) return null;

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  const timeoutId = setTimeout(() => controller.abort(), YTM_REQUEST_TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', abortFromCaller, { once: true });
  try {
    const response = await fetch(ytmApiUrl(path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'X-YouTube-Client-Name': '67',
        'X-YouTube-Client-Version': YTM_WEB_CLIENT_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`YouTube Music HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    if (!YTM_PROXY_BASE && !YTM_USE_DEV_PROXY && !ytmDirectFetchBlocked) {
      ytmDirectFetchBlocked = true;
      console.warn(
        'YouTube Music lyrics require the desktop app or a proxy (VITE_YTM_PROXY); browser CORS blocks Innertube.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', abortFromCaller);
  }
}

function ytmFlexText(column) {
  const renderer = column?.musicResponsiveListItemFlexColumnRenderer;
  const runs = renderer?.text?.runs;
  if (Array.isArray(runs)) return runs.map((run) => run?.text || '').join('');
  return renderer?.text?.simpleText || '';
}

function parseDurationSeconds(text) {
  const match = /(\d{1,3}):([0-5]\d)/.exec(String(text || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function readYtmSearchCandidates(payload) {
  const renderers = collectNodesByKey(payload, 'musicResponsiveListItemRenderer');
  const candidates = [];
  for (const renderer of renderers) {
    const columns = Array.isArray(renderer?.flexColumns) ? renderer.flexColumns : [];
    const title = ytmFlexText(columns[0]).trim();
    if (!title) continue;
    // Subtitle layout: "Artist • Album • 3:21 • 560M plays".
    const parts = ytmFlexText(columns[1])
      .trim()
      .split(/\s*[•·]\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    const artistName = parts[0] && !/^\d{1,3}:[0-5]\d$/.test(parts[0]) ? parts[0] : '';
    const durationText = parts.find((part) => /^\d{1,3}:[0-5]\d$/.test(part)) || '';
    const videoId = renderer?.playlistItemData?.videoId
      || renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content
        ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
      || columns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
        ?.find((run) => run?.navigationEndpoint?.watchEndpoint?.videoId)
        ?.navigationEndpoint.watchEndpoint.videoId
      || '';
    if (!/^[\w-]{11}$/.test(videoId)) continue;
    candidates.push({
      videoId,
      name: title,
      artistName,
      duration: parseDurationSeconds(durationText),
    });
  }
  return candidates;
}

function findYtmLyricsBrowseId(payload) {
  return collectNodesByKey(payload, 'browseId')
    .find((browseId) => typeof browseId === 'string' && browseId.startsWith('MPLYt')) || '';
}

function readYtmTimedLines(lyricsData) {
  const rows = Array.isArray(lyricsData?.timedLyricsData) ? lyricsData.timedLyricsData : null;
  if (!rows || rows.length === 0) return null;
  // ytmusicapi only reports TimedLyrics when every row has a cue range. Mixed
  // payloads are static lyrics in disguise and must not claim timing.
  if (!rows.every((row) => row?.cueRange)) return null;
  const lines = [];
  for (const row of rows) {
    const text = String(row?.lyricLine || '').replace(/\s+/g, ' ').trim();
    const start = Number(row?.cueRange?.startTimeMilliseconds);
    if (!text || !Number.isFinite(start)) continue;
    lines.push({ time: Math.max(0, start / 1000), text });
  }
  if (lines.length === 0) return null;
  return lines.sort((a, b) => a.time - b.time);
}

function getYtmCacheKey(title, artist, duration) {
  return `${normalizeText(title)}|${normalizeText(artist)}|${Math.round(duration || 0)}`;
}

function readYtmCache(key) {
  const entry = ytmCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    ytmCache.delete(key);
    return undefined;
  }
  return entry.value;
}

function writeYtmCache(key, value) {
  if (ytmCache.size >= YTM_CACHE_MAX_ENTRIES) {
    const oldestKey = ytmCache.keys().next().value;
    if (oldestKey !== undefined) ytmCache.delete(oldestKey);
  }
  ytmCache.set(key, { value, expiresAt: Date.now() + YTM_CACHE_TTL_MS });
}

export async function fetchYouTubeMusicLyrics(title, artist, duration, signal = null) {
  throwIfAborted(signal);
  if (!title) return null;

  const cacheKey = getYtmCacheKey(title, artist, duration);
  const cached = readYtmCache(cacheKey);
  if (cached !== undefined) return cached;

  let result = null;
  try {
    const searchPayload = await ytmRequest('search', {
      ...ytmContext('WEB_REMIX', YTM_WEB_CLIENT_VERSION),
      query: [title, artist].filter(Boolean).join(' '),
      params: YTM_SONG_SEARCH_PARAMS,
    }, signal);
    const candidates = searchPayload ? readYtmSearchCandidates(searchPayload) : [];

    // Reuse the shared scorer so a cover or a same-titled song by another
    // artist is rejected with the same evidence rules as manual search.
    const minimumScore = artist ? 125 : 90;
    const ranked = candidates
      .map((candidate) => ({
        candidate,
        score: scoreCandidate(candidate, title, artist, duration),
      }))
      .filter((entry) => entry.score >= minimumScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    for (const { candidate } of ranked) {
      throwIfAborted(signal);
      const nextPayload = await ytmRequest('next', {
        ...ytmContext('WEB_REMIX', YTM_WEB_CLIENT_VERSION),
        videoId: candidate.videoId,
      }, signal);
      const browseId = nextPayload ? findYtmLyricsBrowseId(nextPayload) : '';
      if (!browseId) continue;

      const browsePayload = await ytmRequest('browse', {
        ...ytmContext('ANDROID_MUSIC', YTM_ANDROID_CLIENT_VERSION, { androidSdkVersion: 30 }),
        browseId,
      }, signal);
      if (!browsePayload) continue;

      const lyricsData = collectNodesByKey(browsePayload, 'timedLyricsModel', 1)[0]?.lyricsData;
      const lines = readYtmTimedLines(lyricsData);
      if (!lines) continue;

      const trackName = cleanTrackTitle(candidate.name) || candidate.name;
      result = {
        synced: true,
        lines,
        raw: lines.map((line) => line.text).join('\n'),
        trackName,
        artistName: candidate.artistName || artist,
        duration: candidate.duration || duration,
        source: 'youtube-music',
        videoId: candidate.videoId,
      };
      break;
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    console.warn('YouTube Music lyrics lookup failed:', error);
    result = null;
  }

  writeYtmCache(cacheKey, result);
  return result;
}

async function fetchAdditionalLyrics(
  title,
  artist,
  duration,
  isrc = '',
  expectedOrientations = [],
  signal = null,
) {
  const providers = [
    () => fetchBiniLyrics(title, artist, duration, signal),
    () => fetchLrcRedLyrics(isrc, title, artist, duration, signal),
    () => fetchYouTubeMusicLyrics(title, artist, duration, signal),
    () => fetchBetterLyrics(title, artist, duration, '', signal),
    () => fetchBetterLyrics(title, artist, duration, 'qq', signal),
    () => fetchBetterLyrics(title, artist, duration, 'kugou', signal),
    () => fetchLyricsPlus(title, artist, duration, isrc, signal),
  ];

  for (const fetchProvider of providers) {
    throwIfAborted(signal);
    try {
      const result = await fetchProvider();
      if (
        result?.lines?.length
        && isLyricsDurationAllowed(result)
        && lyricsMatchOrientations(result, expectedOrientations)
      ) {
        return result;
      }
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
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

// A one-word title ("LEG", "BIGBANG") collides with unrelated recordings that
// merely share the name. Such candidates only count when independent
// evidence — raw-label familiarity or artist agreement — backs the same
// recording.
function isSingleTokenLookupTitle(normalizedTitle) {
  const tokens = String(normalizedTitle || '').split(' ').filter(Boolean);
  return tokens.length === 1;
}

function scoreMusicBrainzArtist(recording, targetArtist) {
  const normalizedTargetArtist = normalizeText(targetArtist);
  const normalizedArtist = normalizeText(getMusicBrainzArtistName(recording));
  if (!normalizedTargetArtist || !normalizedArtist) return 0;
  if (normalizedTargetArtist === normalizedArtist) return 70;
  if (
    normalizedArtist.includes(normalizedTargetArtist) ||
    normalizedTargetArtist.includes(normalizedArtist)
  ) {
    return 45;
  }
  const targetWords = normalizedTargetArtist.split(' ');
  const artistWords = normalizedArtist.split(' ');
  let matchedSimilarity = 0;
  for (const word of targetWords) {
    let bestSimilarity = 0;
    for (const artistWord of artistWords) {
      const similarity = fuzzyTokenSimilarity(word, artistWord);
      if (similarity > bestSimilarity) bestSimilarity = similarity;
    }
    matchedSimilarity += bestSimilarity;
  }
  return targetWords.length > 0 ? (matchedSimilarity / targetWords.length) * 30 : 0;
}

function scoreMusicBrainzRecording(recording, targetTitle, targetArtist, duration) {
  const title = recording.title || '';
  const normalizedTargetTitle = normalizeText(targetTitle);
  const normalizedTitle = normalizeText(title);

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
    // MusicBrainz is the spelling-correction stop on the way to lyrics: a
    // typo-ridden filename must still resolve to the real recording so the
    // later LRCLIB lookup can run against clean metadata.
    const targetWords = normalizedTargetTitle.split(' ');
    const titleWords = normalizedTitle.split(' ');
    const coverage = weightedTokenCoverage(targetWords, titleWords);
    const typoRatio = stringSimilarity(normalizedTargetTitle, normalizedTitle);
    const ratio = Math.max(coverage, typoRatio);
    titleScore = ratio >= 0.75 ? 85 * ratio : ratio >= 0.5 ? 60 * ratio : 0;
  }

  if (titleScore < 60) return -1;

  let totalScore = titleScore + scoreMusicBrainzArtist(recording, targetArtist);

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

async function resolveSplitByTitleEvidence(partA, partB, duration, rawTitle = '', signal = null) {
  const evidence = [];
  const normalizedRawTitle = normalizeText(rawTitle);

  for (const possibleTitle of [partA, partB].filter(Boolean)) {
    const normalizedCandidate = normalizeText(possibleTitle);
    const recordings = await queryMusicBrainz(
      `recording:"${possibleTitle.replace(/"/g, '\\"')}"`,
      signal,
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
    // Only count duration evidence when there is something to compare —
    // an unknown file duration must not read as a perfect match.
    const hasDurationEvidence = duration > 0 && durationSeconds > 0;
    const durationDifference = hasDurationEvidence
      ? Math.abs(durationSeconds - duration)
      : 0;
    const durationScore = hasDurationEvidence
      ? (durationDifference <= 5 ? 30 : durationDifference <= 35 ? 10 : 0)
      : 0;
    // A recording whose title also resembles the full raw label is preferred:
    // for "Time - Clock of the Heart" this blocks a wrong resolution to some
    // unrelated recording that is simply called "Time".
    const familiarity = normalizedRawTitle
      ? stringSimilarity(normalizedRawTitle, normalizeText(best.recording.title || ''))
      : 0;

    // A one-word title must also resemble the raw label: "LEG" at the end of
    // "Đại Ca Lớp 12A (...) - LEG" — or "BIGBANG" in front of a Haru Haru
    // file — should not resolve the song to an unrelated recording that
    // happens to share the name.
    if (isSingleTokenLookupTitle(normalizedCandidate) && familiarity < 0.25) continue;

    evidence.push({
      recording: best.recording,
      score: best.titleScore
        + (distinctTitles <= 2 ? 15 : 0)
        + durationScore
        + 25 * familiarity
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

async function waitForMusicBrainzRateLimit(signal = null) {
  throwIfAborted(signal);
  const waitMs = Math.max(0, 1000 - (Date.now() - musicBrainzLastRequestAt));
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  throwIfAborted(signal);
  musicBrainzLastRequestAt = Date.now();
}

async function queryMusicBrainz(query, signal = null) {
  throwIfAborted(signal);
  const cacheKey = query.trim().toLowerCase();
  if (!cacheKey) return [];
  if (musicBrainzCache.has(cacheKey)) return musicBrainzCache.get(cacheKey);

  try {
    await waitForMusicBrainzRateLimit(signal);
    const url = new URL('https://musicbrainz.org/ws/2/recording');
    url.searchParams.set('query', query);
    url.searchParams.set('fmt', 'json');
    url.searchParams.set('limit', '10');
    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) {
      throw new Error(`MusicBrainz HTTP ${response.status}`);
    }
    const data = await response.json();
    const recordings = Array.isArray(data.recordings) ? data.recordings : [];
    musicBrainzCache.set(cacheKey, recordings);
    return recordings;
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    console.warn('MusicBrainz lookup failed:', error);
    return [];
  }
}

/**
 * Resolves an uncertain filename split against MusicBrainz.
 * A split is only accepted when both title/artist evidence and (when present)
 * recording duration support the same recording.
 */
async function resolveWithMusicBrainz(rawTitle, rawArtist, duration, parsed, signal = null) {
  throwIfAborted(signal);
  // Never use filename inference to replace trustworthy artist metadata. An
  // uploader/channel name is not trustworthy though, so it may be replaced
  // with what the resolver finds inside the raw title.
  if (rawArtist && !isUnknownArtist(rawArtist) && !isUploaderLikeArtist(rawArtist)) return null;

  if (!parsed.isOrientationUncertain || !parsed.split) {
    const recordings = await queryMusicBrainz(rawTitle, signal);
    const normalizedRaw = normalizeText(rawTitle);
    const rawTokens = tokenizeNormalized(normalizedRaw);
    const directMatches = recordings
      .map((recording) => {
        const title = recording.title || '';
        const artist = getMusicBrainzArtistName(recording);
        const evidenceWords = [...tokenizeNormalized(title), ...tokenizeNormalized(artist)];
        let matchedSimilarity = 0;
        for (const word of evidenceWords) {
          let bestSimilarity = 0;
          for (const rawToken of rawTokens) {
            const similarity = fuzzyTokenSimilarity(word, rawToken);
            if (similarity > bestSimilarity) bestSimilarity = similarity;
          }
          matchedSimilarity += bestSimilarity;
        }
        const tokenCoverage = evidenceWords.length > 0 ? matchedSimilarity / evidenceWords.length : 0;
        // A typo-ridden filename shares few whole words with the clean
        // recording name, so whole-string edit distance backs up tokens.
        const typoRatio = stringSimilarity(normalizeText(`${title} ${artist}`), normalizedRaw);
        const coverage = Math.max(tokenCoverage, typoRatio);
        const durationSeconds = Number(recording.length || 0) / 1000;
        // Unknown durations must not read as exact matches.
        const hasDurationEvidence = duration > 0 && durationSeconds > 0;
        const durationDifference = hasDurationEvidence
          ? Math.abs(durationSeconds - duration)
          : 0;
        const durationScore = !hasDurationEvidence
          ? 0
          : durationDifference <= 5 ? 30 : durationDifference <= 35 ? 10 : durationDifference > 60 ? -30 : 0;
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
    rawTitle,
    signal,
  );
  if (splitEvidenceMatch) return splitEvidenceMatch;

  const possiblePairs = [
    { title: parsed.split.partA, artist: parsed.split.partB },
    { title: parsed.split.partB, artist: parsed.split.partA },
  ];
  const scored = [];

  for (const pair of possiblePairs) {
    const query = `recording:"${pair.title.replace(/"/g, '\\"')}" AND artist:"${pair.artist.replace(/"/g, '\\"')}"`;
    let recordings = await queryMusicBrainz(query, signal);
    if (recordings.length === 0) {
      recordings = await queryMusicBrainz(`recording:"${pair.title.replace(/"/g, '\\"')}"`, signal);
    }
    for (const recording of recordings) {
      const score = scoreMusicBrainzRecording(recording, pair.title, pair.artist, duration);
      if (score < 0) continue;
      // One-word titles need artist confirmation — without it a coincidental
      // same-name recording resolves the song wrongly (the "LEG" → "Leg" by
      // Arzachel and "BIGBANG" → kids-song failures).
      if (
        isSingleTokenLookupTitle(normalizeText(pair.title)) &&
        scoreMusicBrainzArtist(recording, pair.artist) < 15
      ) {
        continue;
      }
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
 * Loose text comparison for track metadata. Returns true when there is not
 * enough information to reject the match, so provider aliases and slightly
 * different title formatting do not throw away valid cached lyrics.
 */
function textMatchesLoose(expected, actual, minimumTokenCoverage = 0.5) {
  const expectedText = normalizeText(expected);
  const actualText = normalizeText(actual);
  if (!expectedText || !actualText) {
    // normalizeText() drops scripts without \w characters (for example CJK).
    // Do not treat that as "no information": compare the raw strings so
    // "倉木麻衣" does not match an unrelated Latin artist name.
    const rawExpected = String(expected || '').trim().toLowerCase();
    const rawActual = String(actual || '').trim().toLowerCase();
    if (!rawExpected || !rawActual) return true;
    return rawExpected === rawActual
      || rawExpected.includes(rawActual)
      || rawActual.includes(rawExpected);
  }
  if (expectedText === actualText) return true;
  if (expectedText.includes(actualText) || actualText.includes(expectedText)) return true;
  if (stringSimilarity(expectedText, actualText) >= 0.65) return true;

  const expectedTokens = tokenizeNormalized(expectedText);
  const actualTokens = tokenizeNormalized(actualText);
  if (expectedTokens.length === 0 || actualTokens.length === 0) return false;

  let matched = 0;
  for (const token of expectedTokens) {
    if (actualTokens.some((candidate) => fuzzyTokenSimilarity(token, candidate) > 0)) {
      matched += 1;
    }
  }
  return matched / expectedTokens.length >= minimumTokenCoverage;
}

/**
 * Possible (title, artist) readings of the player metadata. When filenames use
 * "A - B" without an artist tag, both orientations are kept because the parser
 * cannot know which side is the performer.
 */
function getLyricsOrientations(rawTitle, rawArtist, parsed = parseTrackAndArtist(rawTitle, rawArtist)) {
  const orientations = [];
  const seen = new Set();
  const add = (title, artist) => {
    const cleanTitle = cleanTrackTitle(title || '');
    const cleanArtist = cleanTrackTitle(artist || '');
    if (!cleanTitle && !cleanArtist) return;
    const key = `${normalizeText(cleanTitle)}|${normalizeText(cleanArtist)}`;
    if (seen.has(key)) return;
    seen.add(key);
    orientations.push({ title: cleanTitle, artist: cleanArtist });
  };

  const knownArtist = rawArtist && !isUnknownArtist(rawArtist) && !isUploaderLikeArtist(rawArtist);
  if (knownArtist) add(parsed.title || rawTitle, rawArtist);
  if (parsed.split) {
    add(parsed.split.partA, parsed.split.partB);
    add(parsed.split.partB, parsed.split.partA);
  }
  if (orientations.length === 0) add(rawTitle, rawArtist);
  return orientations;
}

/**
 * True when a lyrics result's own title/artist metadata agrees with at least
 * one possible reading of the track. This rejects stale or badly matched
 * results such as Barry White's "Never Gonna Give You Up" appearing on a Rick
 * Astley track.
 */
function lyricsMatchOrientations(lyricsData, orientations) {
  if (!lyricsData) return false;
  const title = lyricsData.trackName || lyricsData.name || '';
  const artist = lyricsData.artistName || '';
  if ((!title && !artist) || !Array.isArray(orientations) || orientations.length === 0) {
    return true;
  }

  return orientations.some(({ title: expectedTitle, artist: expectedArtist }) => {
    if (expectedTitle && title && !textMatchesLoose(expectedTitle, title)) return false;
    if (expectedArtist && artist && !textMatchesLoose(expectedArtist, artist)) return false;
    return true;
  });
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
export function getSessionLyrics(rawTitle, rawArtist = '', lookupHint = '') {
  if (!rawTitle) return null;
  const keys = getLookupKeys(rawTitle, rawArtist);
  // When the filename carries a stronger label than the ID3 metadata, validate
  // cached lyrics against that label too. Otherwise a previously cached song
  // by the metadata's (wrong) artist would keep winning before lookup starts.
  const orientations = lookupHint
    ? getLyricsOrientations(lookupHint, '')
    : getLyricsOrientations(rawTitle, rawArtist);

  // 1. Check in-memory cache
  for (const k of keys) {
    if (lyricsCache.has(k)) {
      const cached = lyricsCache.get(k);
      // Drop stale caches from older matching logic or a wrong previous match.
      if (hasUsableLyrics(cached) && lyricsMatchOrientations(cached, orientations)) return cached;
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
          if (hasUsableLyrics(parsed) && lyricsMatchOrientations(parsed, orientations)) {
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
 * Persists an explicitly selected lyric result in sessionStorage while
 * connected to the current server. The entries are cleared when disconnected.
 */
export function saveSelectedLyrics(rawTitle, rawArtist = '', lyricsData) {
  if (!rawTitle || !hasUsableLyrics(lyricsData)) return;
  const keys = getLookupKeys(rawTitle, rawArtist);
  // Mark new manual choices so they stay authoritative even when the provider
  // reports a different artist (covers, live versions, translations). Older
  // entries lack this marker and are checked against the track metadata once.
  const persistedLyrics = { ...lyricsData, _selectedByUser: true };

  for (const key of keys) {
    lyricsCache.set(key, persistedLyrics);
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem(SELECTED_LYRICS_PREFIX + key, JSON.stringify(persistedLyrics));
      }
    } catch (error) {
      console.warn('Unable to persist selected lyrics:', error);
    }
  }
}

/**
 * Retrieves an explicitly selected lyric result persisted in sessionStorage.
 */
export function getSelectedLyrics(rawTitle, rawArtist = '', lookupHint = '') {
  if (!rawTitle) return null;
  const keys = getLookupKeys(rawTitle, rawArtist);
  const orientations = lookupHint
    ? getLyricsOrientations(lookupHint, '')
    : getLyricsOrientations(rawTitle, rawArtist);

  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      for (const key of keys) {
        const stored = window.sessionStorage.getItem(SELECTED_LYRICS_PREFIX + key);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (hasUsableLyrics(parsed)) {
            // Explicit choices made by this version are always trusted. Old
            // selections have no marker, so discard ones that match neither
            // possible title/artist reading (e.g. Barry White's unrelated
            // "Never Gonna Give You Up" saved for a Rick Astley file).
            if (parsed._selectedByUser || lyricsMatchOrientations(parsed, orientations)) {
              lyricsCache.set(key, parsed);
              return parsed;
            }
          }
          window.sessionStorage.removeItem(SELECTED_LYRICS_PREFIX + key);
        }
      }
    }
  } catch (error) {
    console.warn('Unable to read selected lyrics:', error);
  }

  return null;
}

/**
 * Removes the saved lyrics association for a single track. This drops both the
 * explicit manual selection and the automatic session cache, so the track can
 * be matched again from scratch without affecting other songs.
 */
export function unlinkLyricsForTrack(rawTitle, rawArtist = '') {
  if (!rawTitle) return;
  const keys = getLookupKeys(rawTitle, rawArtist);
  // An unlink is an explicit "try again", so do not let a cached search
  // shortlist immediately reproduce the association the user just removed.
  searchResultCache.clear();

  for (const key of keys) {
    lyricsCache.delete(key);
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage?.removeItem(SELECTED_LYRICS_PREFIX + key);
        window.sessionStorage?.removeItem(SESSION_CACHE_PREFIX + key);
      }
    } catch (error) {
      console.warn('Unable to unlink lyrics:', error);
    }
  }
}

/**
 * Clears all lyrics found during the current server connection.
 */
export function clearSelectedLyrics() {
  lyricsCache.clear();
  try {
    if (typeof window !== 'undefined') {
      const sessionKeysToRemove = [];
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index);
        if (
          key?.startsWith(SELECTED_LYRICS_PREFIX)
          || key?.startsWith(SESSION_CACHE_PREFIX)
        ) {
          sessionKeysToRemove.push(key);
        }
      }
      sessionKeysToRemove.forEach((key) => window.sessionStorage.removeItem(key));

      // Remove entries written by versions that incorrectly used localStorage.
      // This prevents stale selections from surviving a server disconnect.
      if (window.localStorage) {
        const legacyKeysToRemove = [];
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index);
          if (key?.startsWith(SELECTED_LYRICS_PREFIX)) {
            legacyKeysToRemove.push(key);
          }
        }
        legacyKeysToRemove.forEach((key) => window.localStorage.removeItem(key));
      }
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
 * @param {string} [lookupHint=''] Strong alternate label from the filename/path
 * @param {AbortSignal|null} [signal=null] Cancels the lookup and its network requests
 * @returns {Promise<{ synced: boolean, lines: Array<{ time: number|null, text: string }>, raw?: string, trackName?: string, artistName?: string, instrumental?: boolean, source: string } | null>}
 */
export async function fetchLyrics(
  rawTitle,
  rawArtist = '',
  duration = 0,
  forceRefresh = false,
  lookupHint = '',
  signal = null,
) {
  throwIfAborted(signal);
  if (!isLyricsDurationAllowed({ duration })) {
    return {
      synced: false,
      lines: [],
      error: 'Lyrics are unavailable for tracks shorter than 1 minute 30 seconds.',
      trackName: cleanTrackTitle(rawTitle) || rawTitle,
      artistName: rawArtist,
      source: 'lrclib',
    };
  }
  // Strip uploader/channel suffixes that repeat or trail the artist before
  // parsing: "Song - Artist | Music is Life - EDM" → "Song - Artist". The raw
  // strings are still used for cache keys below.
  const lookupTitle = stripRedundantArtistSegments(rawTitle, rawArtist) || rawTitle;
  const parsed = parseTrackAndArtist(lookupTitle, rawArtist);
  const hintLabel = typeof lookupHint === 'string' ? lookupHint.trim() : '';
  const hintParsed = hintLabel ? parseTrackAndArtist(hintLabel, '') : null;
  let { title, artist, versionTag, split, isOrientationUncertain } = parsed;
  if (!title) return null;

  if (!forceRefresh) {
    const selectedLyrics = getSelectedLyrics(rawTitle, rawArtist, hintLabel);
    if (selectedLyrics) {
      return selectedLyrics;
    }

    const sessionCached = getSessionLyrics(rawTitle, rawArtist, hintLabel);
    if (sessionCached && hasUsableLyrics(sessionCached)) {
      return sessionCached;
    }
  }

  throwIfAborted(signal);

  // ── Manual-search parity for automatic detection ────────────────────────────
  // Build the same free-form label a user would paste into the search box, run
  // the exact same ranking, and take the first usable result. This deliberately
  // does not apply the old automatic candidate blacklist/threshold: if manual
  // search would show it first, automatic lookup uses it too. Junk tags are
  // already normalised by searchLyrics().
  const autoSearchLabel = hintLabel
    || (/\s[-–—]\s/.test(rawTitle || '') ? rawTitle : '')
    || [rawArtist, rawTitle].filter(Boolean).join(' - ')
    || parsed.title;
  if (autoSearchLabel) {
    try {
      const autoResults = await searchLyrics(autoSearchLabel, duration, {
        semantic: 'auto',
        remember: false,
        signal,
      });
      const autoTop = autoResults.find(
        (candidate) => candidate.instrumental || candidate.syncedLyrics || candidate.plainLyrics,
      );
      const autoFormatted = autoTop ? formatCandidateResult(autoTop) : null;
      if (autoFormatted && hasUsableLyrics(autoFormatted)) {
        saveSessionLyrics(rawTitle, rawArtist, autoFormatted);
        return autoFormatted;
      }
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      console.warn('Automatic manual-style lyrics search failed:', error);
    }
  }

  try {
    const musicBrainzMatch = await resolveWithMusicBrainz(lookupTitle, rawArtist, duration, parsed, signal);
    if (musicBrainzMatch) {
      title = musicBrainzMatch.title;
      artist = musicBrainzMatch.artist;
      split = null;
      isOrientationUncertain = false;
    }

    const cleanCore = stripExtraTitleDetails(title);
    const queries = [];
    const embeddedHints = inferEmbeddedArtistTitleHints(lookupTitle, rawArtist);

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

    // Filename/path label. Bad ID3 tags can point at a completely different
    // artist; the original "Artist - Title" filename is often the only
    // trustworthy signal left. These queries feed the same scorer as manual
    // search, so title + artist + duration decide which label wins.
    if (hintParsed?.title) {
      const hintTitle = stripExtraTitleDetails(hintParsed.title);
      const hintArtist = stripExtraTitleDetails(hintParsed.artist);
      if (hintTitle) {
        if (hintArtist) {
          queries.push({
            source: 'hint',
            targetTitle: hintTitle,
            targetArtist: hintArtist,
            params: { track_name: hintTitle, artist_name: hintArtist },
          });
          queries.push({
            source: 'hint',
            targetTitle: hintTitle,
            targetArtist: hintArtist,
            params: { q: `${hintTitle} ${hintArtist}` },
          });
        }
        queries.push({
          source: 'hint',
          targetTitle: hintTitle,
          targetArtist: hintArtist,
          params: { track_name: hintTitle },
        });
      }
    }

    if (isOrientationUncertain && split) {
      const cleanA = stripExtraTitleDetails(split.partA);
      const cleanB = stripExtraTitleDetails(split.partB);
      queries.push({ targetTitle: cleanA, targetArtist: cleanB, params: { track_name: cleanA, artist_name: cleanB } });
      queries.push({ targetTitle: cleanB, targetArtist: cleanA, params: { track_name: cleanB, artist_name: cleanA } });
      queries.push({ targetTitle: cleanA, targetArtist: cleanB, params: { q: `${cleanA} ${cleanB}` } });
      queries.push({ targetTitle: cleanA, targetArtist: cleanB, params: { track_name: cleanA } });
      queries.push({ targetTitle: cleanB, targetArtist: cleanA, params: { track_name: cleanB } });
      // A version tag must reach the versioned entry, not the original: the
      // side that carries the tag gets a dedicated "Title (Version)" query
      // even while the orientation is still uncertain.
      if (versionTag) {
        const tagText = normalizeText(versionTag);
        if (tagText && normalizeText(split.partB).includes(tagText)) {
          const versionedB = normalizeText(cleanB).includes(tagText)
            ? cleanB
            : `${cleanB} (${versionTag})`;
          queries.push({ targetTitle: versionedB, targetArtist: cleanA, params: { track_name: versionedB, artist_name: cleanA } });
          queries.push({ targetTitle: versionedB, targetArtist: cleanA, params: { track_name: versionedB } });
        }
        if (tagText && normalizeText(split.partA).includes(tagText)) {
          const versionedA = normalizeText(cleanA).includes(tagText)
            ? cleanA
            : `${cleanA} (${versionTag})`;
          queries.push({ targetTitle: versionedA, targetArtist: cleanB, params: { track_name: versionedA, artist_name: cleanB } });
          queries.push({ targetTitle: versionedA, targetArtist: cleanB, params: { track_name: versionedA } });
        }
      }
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
    let bestTargetTitle = '';
    let bestTargetArtist = '';
    const candidatesById = new Map();

    // Collect every candidate first so ranking can weigh tokens by how rare
    // they are across the whole result set (see createIdfWeightFn).
    for (const q of uniqueQueries) {
      throwIfAborted(signal);
      const candidates = await queryLrclib(q.params, undefined, signal);
      for (const candidate of candidates) {
        if (
          !isLyricsDurationAllowed(candidate)
          || !(candidate.instrumental || candidate.syncedLyrics || candidate.plainLyrics)
        ) continue;

        const candidateId = candidate.id || `${candidate.name || candidate.trackName || ''}__${candidate.artistName || ''}__${candidate.duration || ''}`;
        const entry = candidatesById.get(candidateId);
        if (entry) {
          if (!entry.queries.includes(q)) entry.queries.push(q);
        } else {
          candidatesById.set(candidateId, { candidate, queries: [q] });
        }
      }
    }

    // Google-style rarity weighting (TF-IDF/BM25 flavor): tokens shared by many
    // candidates ("Official", "Remix", "Soundtrack") carry little signal, while
    // rare tokens such as artist names decide between lookalike songs.
    const idfFn = createIdfWeightFn(
      [...candidatesById.values()].map(({ candidate }) =>
        tokenizeNormalized(`${candidate.name || candidate.trackName || ''} ${candidate.artistName || ''}`),
      ),
    );

    for (const { candidate, queries } of candidatesById.values()) {
      let score = -1;
      let bestQuery = queries[0];
      for (const q of queries) {
        let candidateScore = scoreCandidate(candidate, q.targetTitle, q.targetArtist, duration, { versionTag, idfFn });
        // Filename labels win exact ties: the ID3 tag is often the unreliable
        // part when a path-derived label exists. Duration and artist evidence
        // still outweigh this one-point tie-breaker.
        if (candidateScore > 0 && q.source === 'hint') candidateScore += 1;
        if (candidateScore > score) {
          score = candidateScore;
          bestQuery = q;
        }
      }
      if (score > bestScore) {
        firstMatch = candidate;
        bestScore = score;
        detectedTitle = candidate.name || candidate.trackName || bestQuery.targetTitle;
        detectedArtist = candidate.artistName || bestQuery.targetArtist;
        bestTargetTitle = bestQuery.targetTitle || '';
        bestTargetArtist = bestQuery.targetArtist || '';
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
      // The LRCLIB result set resolved which side of "A - B" is the title even
      // when no candidate was trustworthy enough to display. Use that reading
      // first for fallback providers instead of the parser's blind guess.
      // With a strong filename label, validate fallback-provider results
      // against that label rather than the (possibly wrong) ID3 metadata.
      const expectedOrientations = hintLabel
        ? getLyricsOrientations(hintLabel, '')
        : getLyricsOrientations(rawTitle, rawArtist, parsed);
      const attempts = [];
      const seenAttempts = new Set();
      const addAttempt = (attemptTitle, attemptArtist) => {
        const cleanAttemptTitle = stripExtraTitleDetails(attemptTitle || '');
        const cleanAttemptArtist = stripExtraTitleDetails(attemptArtist || '');
        if (!cleanAttemptTitle && !cleanAttemptArtist) return;
        const key = `${normalizeText(cleanAttemptTitle)}|${normalizeText(cleanAttemptArtist)}`;
        if (seenAttempts.has(key)) return;
        seenAttempts.add(key);
        attempts.push({ title: cleanAttemptTitle, artist: cleanAttemptArtist });
      };

      if (hintParsed?.title) addAttempt(hintParsed.title, hintParsed.artist);
      if (bestTargetTitle) addAttempt(bestTargetTitle, bestTargetArtist);
      if (isOrientationUncertain && split) {
        addAttempt(split.partB, split.partA);
        addAttempt(split.partA, split.partB);
      } else if (!bestTargetTitle) {
        addAttempt(cleanCore || title, artist);
      }
      if (attempts.length === 0) addAttempt(cleanCore || title, artist);

      let additionalLyrics = null;
      for (const attempt of attempts) {
        throwIfAborted(signal);
        additionalLyrics = await fetchAdditionalLyrics(
          attempt.title,
          attempt.artist,
          duration,
          musicBrainzMatch?.isrc || '',
          expectedOrientations,
          signal,
        );
        if (additionalLyrics) break;
      }

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
    if (signal?.aborted || err?.name === 'AbortError') throw err;
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
 * Builds ranking/search targets for the manual search box. Each target is a
 * (title, artist) pair, so "Hãy Ra Khỏi Người Đó Đi - Phan Mạnh Quỳnh" is
 * interpreted in both orientations instead of either side becoming a standalone
 * song title — that is what previously let uploader-style titles such as
 * "Phan Mạnh Quỳnh | Khi Lòng Ta Hiểu" outrank the actual searched song.
 */
function getManualSearchTargets(query) {
  const targets = [];
  const seen = new Set();
  const add = (title, artist = '') => {
    let cleanedTitle = cleanTrackTitle(title || '');
    let cleanedArtist = cleanTrackTitle(artist || '');
    if (isJunkSegment(cleanedTitle)) cleanedTitle = '';
    // Do not blacklist artist-looking words here. An explicit search label may
    // legitimately contain "Music", "Radio", "Studio", etc.; the ranking step
    // already decides whether the result is relevant.
    if (isJunkSegment(cleanedArtist)) cleanedArtist = '';
    if (!cleanedTitle && !cleanedArtist) return;
    const key = `${normalizeText(cleanedTitle)}|${normalizeText(cleanedArtist)}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ title: cleanedTitle, artist: cleanedArtist });
  };

  add(query);

  const parsed = parseTrackAndArtist(query, '');
  add(parsed.title, parsed.artist);
  // Ambiguous "A - B" labels need both orientations. Without this, a filename
  // like "Đổi Thay - Hồ Quang Hiếu" only searches the parser's default
  // artist-first reading and never tries the actual title with its artist.
  if (parsed.isOrientationUncertain && parsed.split) {
    add(parsed.split.partA, parsed.split.partB);
  }

  // A pasted label commonly looks like "Song - Artist | Music is Life - EDM" or
  // "Artist A x Artist B - Song Title". Search each meaningful segment and both
  // orientations of its title/artist split — including bracket groups such as
  // "Song (Artist)" — so users do not have to erase collaborators or channel
  // names before a lookup works.
  const { segments } = extractSegments(query);
  for (const segment of segments) {
    if (isJunkSegment(segment)) continue;
    add(segment);
    const subparts = splitCreditParts(segment)
      // Feature credits are not a title/artist side of their own.
      .filter((part) => !/^(?:feat|ft|with|prod|produced|by)\b/i.test(part));
    if (subparts.length < 2) continue;
    const first = subparts[0];
    const last = subparts[subparts.length - 1];
    if (!isJunkSegment(first)) add(first, subparts.slice(1).join(' ')); // "Title - Artist"
    if (!isJunkSegment(last)) add(last, subparts.slice(0, -1).join(' ')); // "Artist - Title"
  }

  return targets;
}

/**
 * Fraction of the candidate title the target explains. Used to scale the
 * substring tiers of scoreSearchCandidate so a short target (an artist name)
 * cannot promote a mangled title that merely begins with it.
 */

// Lexical scores above this are already excellent matches. Keeping the scale
// fixed (rather than normalizing per search) means a weak candidate cannot look
// perfect merely because every other result was weak too.
const SEARCH_LEXICAL_FULL_SCORE = 170;
const SEARCH_SEMANTIC_WEIGHT = 0.25;
const SEARCH_SEMANTIC_POOL_SIZE = 48;
// Sentence-embedding cosines usually sit around 0.2 (unrelated) to 0.9
// (near-identical), so stretch that range into a useful 0..1 signal.
const SEARCH_SEMANTIC_FLOOR = 0.2;
const SEARCH_SEMANTIC_CEILING = 0.9;

function normalizeSemanticSimilarity(score) {
  if (!Number.isFinite(score)) return 0;
  const range = SEARCH_SEMANTIC_CEILING - SEARCH_SEMANTIC_FLOOR;
  return Math.max(0, Math.min(1, (score - SEARCH_SEMANTIC_FLOOR) / range));
}

async function getSemanticSearchScores(query, candidates) {
  if (!query || candidates.length < 2) return null;
  try {
    // Loaded on demand so the embedding model stays out of the main bundle and
    // is only downloaded when the user actually opens manual lyrics search.
    const { scoreCandidatesSemantically } = await import('./semanticSearch.js');
    return await scoreCandidatesSemantically(query, candidates);
  } catch (error) {
    console.warn('Semantic lyrics ranking unavailable:', error);
    return null;
  }
}

const SEARCH_MAX_QUERY_LENGTH = 80;
const SEARCH_RESULT_LIMIT = 10;
const SEARCH_CACHE_MAX_ENTRIES = 32;
const SEARCH_RECENT_LIMIT = 12;
const SEARCH_RECENT_KEY = 'localstream_lyrics_recent_searches';
const SEARCH_MAX_PARALLEL_QUERIES = 4;
// An exact title + artist candidate (100 + 50, plus duration/sync points) is
// safe to accept after the first, cheap title+artist query. Anything weaker
// falls through to the broader searches below.
const SEARCH_FAST_ACCEPT_SCORE = 145;
const SEARCH_FREEFORM_FAST_ACCEPT_SCORE = 120;

let recentSearchQueries = null;

/**
 * Limits a pasted lyric/query to something a search API can handle quickly.
 * Preserves a trailing space while typing; use clampSearchQuery() for the value
 * actually sent to the API.
 */
export function limitSearchQueryInput(value) {
  if (!value || typeof value !== 'string') return '';
  const compact = value.replace(/\s+/g, ' ');
  if (compact.length <= SEARCH_MAX_QUERY_LENGTH) return compact;
  const slice = compact.slice(0, SEARCH_MAX_QUERY_LENGTH);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace >= Math.floor(SEARCH_MAX_QUERY_LENGTH * 0.6)
    ? slice.slice(0, lastSpace)
    : slice).trimEnd();
}

/**
 * Normalised query used for both network requests and cache keys.
 */
export function clampSearchQuery(query) {
  return limitSearchQueryInput(query).trim();
}

function readStoredRecentSearches() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SEARCH_RECENT_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value) => typeof value === 'string' && value.trim())
      .slice(0, SEARCH_RECENT_LIMIT);
  } catch {
    return [];
  }
}

function getRecentSearchQueries() {
  if (recentSearchQueries === null) recentSearchQueries = readStoredRecentSearches();
  return recentSearchQueries;
}

function rememberSearchQuery(query) {
  const clean = clampSearchQuery(query);
  if (!clean) return;
  const normalized = normalizeText(clean);
  const next = [
    clean,
    ...getRecentSearchQueries().filter((item) => normalizeText(item) !== normalized),
  ].slice(0, SEARCH_RECENT_LIMIT);
  recentSearchQueries = next;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SEARCH_RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private browsing; history stays in memory.
  }
}

function readSearchCache(key) {
  const entry = searchResultCache.get(key);
  if (!entry) return null;
  entry.results = entry.results.filter(isLyricsDurationAllowed);
  if (entry.results.length === 0) {
    searchResultCache.delete(key);
    return null;
  }
  searchResultCache.delete(key);
  searchResultCache.set(key, entry);
  return entry;
}

function storeSearchCache(key, results, suggestible) {
  if (!results.length) return;
  if (searchResultCache.has(key)) searchResultCache.delete(key);
  searchResultCache.set(key, { results, suggestible });
  while (searchResultCache.size > SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = searchResultCache.keys().next().value;
    searchResultCache.delete(oldestKey);
  }
}

/**
 * Returns the shortlist already fetched for a query, if one exists.
 * Automatic lookup runs the same free-form search as the manual box, so the
 * search window can paint those results immediately while a fresh ranking
 * runs in the background.
 */
export function getCachedSearchResults(query, duration = 0) {
  const cleanQuery = clampSearchQuery(query);
  if (!cleanQuery) return [];
  const normalized = normalizeText(cleanQuery);
  const keyPrefix = `${normalized}|${Math.round(Number(duration) || 0)}|`;
  // Prefer a semantic ranking, then the automatic (lexical) shortlist used by
  // track lookup, then any other cached mode for the same query.
  for (const mode of ['semantic', 'auto', 'lexical']) {
    const entry = readSearchCache(`${keyPrefix}${mode}`);
    if (entry?.results?.length) return entry.results;
  }
  return [];
}

function getSearchResultSnippet(candidate) {
  if (!candidate) return '';
  if (candidate.instrumental) return 'Instrumental track';
  const raw = candidate.plainLyrics || candidate.syncedLyrics || '';
  if (!raw) return '';
  const lines = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/(?:\[[^\]]*\]\s*)+/g, '').trim())
    .filter(Boolean)
    .slice(0, 2);
  return lines.join(' • ').slice(0, 160);
}

function isLyricsDurationAllowed(candidate) {
  const duration = Number(candidate?.duration);
  return !Number.isFinite(duration)
    || duration <= 0
    || duration >= MIN_LYRICS_DURATION_SECONDS;
}

/**
 * Local auto-suggest. Suggestions come from manual search history and result
 * titles already in the LRU cache, so no request is sent while the user types.
 */
export function getSearchSuggestions(prefix, limit = 6) {
  const cleanPrefix = clampSearchQuery(prefix);
  const normalizedPrefix = normalizeText(cleanPrefix);
  if (normalizedPrefix.length < 2) return [];

  const suggestions = [];
  const seen = new Set();
  const push = (value, label, detail) => {
    const cleanValue = clampSearchQuery(value);
    const key = normalizeText(cleanValue);
    if (!key || seen.has(key) || key === normalizedPrefix) return;
    if (!key.startsWith(normalizedPrefix) && !key.includes(normalizedPrefix)) return;
    seen.add(key);
    suggestions.push({
      value: cleanValue,
      label: label || cleanValue,
      detail: detail || '',
      startsWith: key.startsWith(normalizedPrefix),
    });
  };

  // Prefer cached song/artist labels, then fall back to previous manual queries.
  for (const entry of [...searchResultCache.values()].reverse()) {
    if (!entry.suggestible) continue;
    for (const candidate of entry.results) {
      const title = getCandidateTitle(candidate) || candidate.name || candidate.trackName || '';
      const artist = candidate.artistName || '';
      push(artist ? `${title} - ${artist}` : title, title, artist);
    }
  }
  for (const query of getRecentSearchQueries()) {
    push(query, query, 'Recent search');
  }

  return suggestions
    .sort((left, right) => Number(right.startsWith) - Number(left.startsWith))
    .slice(0, limit)
    .map(({ value, label, detail }) => ({ value, label, detail }));
}

/**
 * Searches LRCLIB for track candidates matching a freeform query.
 *
 * Queries are prioritised instead of blasting every variant at the server:
 *   1. exact title + artist (usually one or two requests, accepted immediately
 *      when it produces an exact match),
 *   2. the freeform query/title fallback,
 *   3. the remaining title/artist orientations.
 * The final shortlist is locally ranked and limited to 10 rows.
 */
export async function searchLyrics(query, duration = 0, options = {}) {
  const cleanQ = clampSearchQuery(query);
  if (!cleanQ) return [];

  const { semantic = true, remember = true, signal = null } = options;
  throwIfAborted(signal);
  const semanticMode = semantic === 'auto' ? 'auto' : semantic === false ? 'lexical' : 'semantic';
  const cacheKey = `${normalizeText(cleanQ)}|${Math.round(Number(duration) || 0)}|${semanticMode}`;
  const cached = readSearchCache(cacheKey);
  if (cached) {
    if (remember) {
      cached.suggestible = true;
      rememberSearchQuery(cleanQ);
    }
    return cached.results;
  }

  const cleaned = cleanTrackTitle(cleanQ);
  const targets = getManualSearchTargets(cleanQ);
  // Prefer the orientation whose title side looks like a song title. This is
  // what lets "Đổi Thay - Hồ Quang Hiếu" try title="Đổi Thay" first instead of
  // wasting an indexed lookup on the reversed pair.
  const targetLikelihood = (target) =>
    countTitleSignalWords(target.title) - countTitleSignalWords(target.artist);
  const primaryTargets = targets
    .filter((target) => target.title && target.artist)
    .sort((left, right) => targetLikelihood(right) - targetLikelihood(left))
    .slice(0, 2);
  const allCandidates = [];
  const seenCandidates = new Set();
  const seenQueries = new Set();

  const addCandidates = (items) => {
    for (const candidate of items) {
      if (!isLyricsDurationAllowed(candidate)) continue;
      const id = candidate.id || `${candidate.trackName || candidate.name || ''}_${candidate.artistName || ''}`;
      if (seenCandidates.has(id)) continue;
      seenCandidates.add(id);
      allCandidates.push(candidate);
    }
  };

  const runBatch = async (queries, { retryDelays } = {}) => {
    throwIfAborted(signal);
    const batch = [];
    for (const params of queries) {
      if (!params) continue;
      const key = `${normalizeText(params.track_name || '')}|${normalizeText(params.artist_name || '')}|${normalizeText(params.q || '')}`;
      if (seenQueries.has(key)) continue;
      seenQueries.add(key);
      batch.push(params);
      if (batch.length >= SEARCH_MAX_PARALLEL_QUERIES) break;
    }
    if (batch.length === 0) return;
    const responses = await Promise.all(
      batch.map((params) => queryLrclib(params, retryDelays, signal)),
    );
    for (const items of responses) addCandidates(items);
  };

  const evaluateLexical = async () => {
    // The lexical ranking pipeline (inverted index + IDF + fuzzy scoring) runs
    // inside the lyrics search Web Worker, keeping the UI thread free while
    // candidate batches are scored against the query.
    try {
      const entries = await scoreCandidatesInWorker({
        candidates: allCandidates,
        query: cleanQ,
        duration,
        targets,
      });
      return entries;
    } catch (error) {
      // Worker failures (or environments without module workers) must never
      // take the user back to a blocked UI thread without results.
      console.warn('Lyrics search scoring worker unavailable, falling back to main-thread scoring:', error);
      const { entries } = await scoreLyricsCandidates({
        candidates: allCandidates,
        query: cleanQ,
        duration,
        targets,
      });
      return entries;
    }
  };

  const finalizeSearchResults = async (entries, allowSemantic) => {
    throwIfAborted(signal);
    const semanticByIndex = new Map();
    if (allowSemantic && entries.length > 1) {
      const semanticPool = [...entries]
        .sort((left, right) => right.score - left.score)
        .slice(0, SEARCH_SEMANTIC_POOL_SIZE);
      const semanticScores = await getSemanticSearchScores(
        cleanQ,
        semanticPool.map((entry) => entry.candidate),
      );
      if (semanticScores) {
        for (const scored of semanticScores) {
          const entry = semanticPool[scored.index];
          if (entry && Number.isFinite(scored.score)) {
            semanticByIndex.set(entry.index, scored.score);
          }
        }
      }
    }

    throwIfAborted(signal);
    const results = entries
      .map((entry) => {
        const lexicalScore = Math.min(1, entry.score / SEARCH_LEXICAL_FULL_SCORE);
        const semanticScore = normalizeSemanticSimilarity(semanticByIndex.get(entry.index));
        return {
          ...entry,
          combinedScore:
            (lexicalScore * (1 - SEARCH_SEMANTIC_WEIGHT) +
              semanticScore * SEARCH_SEMANTIC_WEIGHT) *
            100,
        };
      })
      .sort(
        (left, right) =>
          right.combinedScore - left.combinedScore ||
          right.score - left.score ||
          left.durationDelta - right.durationDelta ||
          left.index - right.index,
      )
      .slice(0, SEARCH_RESULT_LIMIT)
      .map(({ candidate }) => ({
        ...candidate,
        snippet: getSearchResultSnippet(candidate),
      }));

    if (results.length > 0) {
      storeSearchCache(cacheKey, results, remember);
      if (remember) rememberSearchQuery(cleanQ);
    }
    return results;
  };

  const fastThreshold = primaryTargets.length > 0
    ? SEARCH_FAST_ACCEPT_SCORE
    : SEARCH_FREEFORM_FAST_ACCEPT_SCORE;
  const isFastEnough = (entries) =>
    entries.length > 0
    && entries[0].score >= fastThreshold
    // A same-title cover with a wildly different runtime is not a safe
    // shortcut; let the full-text pass look for the recording that matches.
    && (duration <= 0 || entries[0].durationDelta <= 20);

  // 1. Cheap indexed lookup: the most likely title + artist orientation. This
  // is the one-round-trip path for an ordinary "Artist - Title" search. No
  // retries here: if LRCLIB is load-shedding, fail over to full text instead of
  // making the user wait through two backoff delays.
  const firstBatch = primaryTargets.length > 0
    ? [{ track_name: primaryTargets[0].title, artist_name: primaryTargets[0].artist }]
    : [{ q: cleanQ }];
  await runBatch(firstBatch, primaryTargets.length > 0 ? { retryDelays: [] } : {});
  let lexicalEntries = evaluateLexical();
  if (isFastEnough(lexicalEntries)) {
    return finalizeSearchResults(lexicalEntries, false);
  }

  // 2. Full-text/title fallback, still only a couple of requests. The second
  // title/artist orientation is tried here as well because a filename can be
  // written in either order.
  await runBatch([
    { q: cleanQ },
    cleaned && cleaned !== cleanQ ? { q: cleaned } : null,
    primaryTargets[1]
      ? { track_name: primaryTargets[1].title, artist_name: primaryTargets[1].artist }
      : null,
    primaryTargets[0]?.title ? { track_name: primaryTargets[0].title } : null,
  ]);
  lexicalEntries = await evaluateLexical();
  if (isFastEnough(lexicalEntries)) {
    return finalizeSearchResults(lexicalEntries, false);
  }

  // 3. Remaining title/artist orientations, capped to avoid an LRCLIB burst.
  const thirdBatch = [];
  for (const target of targets) {
    if (target.title && target.artist) {
      thirdBatch.push({ track_name: target.title, artist_name: target.artist });
    }
    if (target.title) {
      thirdBatch.push({ track_name: target.title });
      if (tokenizeNormalized(target.title).length >= 2) {
        thirdBatch.push({ q: target.title });
      }
    }
  }
  await runBatch(thirdBatch);
  lexicalEntries = await evaluateLexical();

  const useSemantic = semantic === true
    || (semantic === 'auto' && isSemanticSearchReady());
  return finalizeSearchResults(lexicalEntries, useSemantic);
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
