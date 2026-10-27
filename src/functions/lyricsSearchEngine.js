// Pure lexical search engine for lyrics.
//
// This module intentionally has no dependencies on the network layer, the
// in-memory caches, or the DOM: it only contains text normalization, title
// cleanup, fuzzy token matching and candidate scoring. That keeps it small and
// free of Electron/browser-only imports so it can run inside a Web Worker via
// `new Worker(new URL(...), { type: 'module' })` without dragging the whole
// lyrics service (fetchers, caches, React glue) into the worker bundle.

// Bracket words stripped from titles: video/audio production tags plus
// album/track listing markers ("(Album 22 - Track No.10)"). Word boundaries
// keep real words such as "Soundtrack" and "albums" intact.
export const JUNK_BRACKET_WORDS = 'official|m\/?v|video|audio|lyrics?|mp3|topic|hd|4k|remaster|sub|vietsub|karaoke|visualizer|teaser|parody|mashup|\balbum\b|\btrack\b|\d{3,4}p|x26[45]|h\.?26[45]|hevc|web-?dl|webrip|blu-?ray';
export const JUNK_SQUARE_BRACKET_REGEX = new RegExp(`\[[^\]]*(?:${JUNK_BRACKET_WORDS})[^\]]*\]`, 'gi');
export const JUNK_ROUND_BRACKET_REGEX = new RegExp(`\([^)]*(?:${JUNK_BRACKET_WORDS})[^)]*\)`, 'gi');

/**
 * Remove audio/video file extensions, track numbers, quotes, and common YouTube video tags from a track title.
 * Blacklists terms like "Lyrics", "Lyric", "MP3", "Topic", video tags, and hashtags.
 */
export function cleanTrackTitle(title) {
  if (!title || typeof title !== 'string') return '';
  let clean = title.trim();

  // Strip audio/video file extensions (.mp3, .flac, .wav, .m4a, .aac, .ogg, .opus, .wma, .mp4, .mkv, .webm, .avi)
  clean = clean.replace(/\.(?:mp3|flac|wav|m4a|aac|ogg|opus|wma|mp4|mkv|webm|avi)\b/gi, '');

  // Strip leading track numbers like "01. ", "1. ", "1 - ", "01 " — but not
  // digit-leading song titles ("4 Walls", "7 Rings").
  clean = clean.replace(/^(?:\d+[.)]\s+|0\d+\s+|\d+\s+[-–—]\s+)/, '');

  // Strip YouTube promo hashtags ("#HDLDĐ #HayDungLaiDiEm"). A tag must
  // contain a letter, so legitimate title parts like "#1 Crush" survive.
  clean = clean.replace(/(^|\s)#(?=[a-zA-ZÀ-ỹ_]*[a-zA-ZÀ-ỹ])[a-zA-Z0-9À-ỹ_]+/g, '$1');
  // Empty bracket shells left behind by removed hashtags ("Song (#tag)").
  clean = clean.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '');

  // Strip common YouTube, MV, quality, bitrate, Lyrics, and MP3 brackets
  // Matches [MV], [M/V], [Official Video], [Official MV], (Official Music Video), (Lyric Video 4K), (Lyrics), [Lyrics], [MP3], [1080p], [x264], etc.
  // Version modifiers (Live Version, Acoustic Version, English Ver) are NOT in
  // this blacklist: they identify which recording the file is, and removing
  // them makes providers return the original version's lyrics.
  clean = clean.replace(JUNK_SQUARE_BRACKET_REGEX, '');
  clean = clean.replace(JUNK_ROUND_BRACKET_REGEX, '');
  clean = clean.replace(/\s*\([^)]*_(?:\d+K|\d+KB|\d+MB)\)\s*$/i, '');
  clean = clean.replace(/\s*\[[^\]]*(?:kbps|flac|lossless)[^\]]*\]/i, '');
  clean = clean.replace(/\s*\([^)]*(?:kbps|flac|lossless)[^)]*\)/i, '');

  // Strip album/track listing tails like "Album 22 - Track No.10" that some
  // download sources append after the song title.
  clean = clean.replace(/\s+(?:[|/\\•\-–—~:]\s*)?(?=\b(?:album|track)\b\s*(?:no\.?|#|number\s*)?\s*\d+).*$/i, '');

  // Strip pipe/dash/slash/bullet video/audio suffixes like "| Official Music Video", "- MV", "// M/V", "• Official MV", "- Lyrics", "| MP3", " Video"
  clean = clean.replace(
    /\s*(?:[|/\\•\-–—~:]\s*)?(?:official\s*(?:music\s*video|m\/?v|video|audio|lyric\s*video)?|m\/?v|music\s*video|lyric\s*video|videoclip|video|visualizer|lyrics?|mp3)\s*$/gi,
    // Never reduce a title that is only the word itself ("Video") to nothing.
    (match, offset, whole) => (whole.slice(0, offset).trim() ? '' : match),
  );

  // Strip blacklisted standalone keywords like "MV", "M/V", "Official Video", "Lyric Video", "Lyrics", "MP3", "Topic"
  clean = clean.replace(/\b(?:official\s*(?:music\s*video|video|audio|m\/?v)?|m\/?v|hd|4k|full\s*hd|lyric\s*video|visualizer|lyrics?|mp3|topic|\d{3,4}p)\b/gi, '');

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

  // Strip all remaining brackets and braces — except groups embedded inside a
  // word, which are identifiers rather than credits ("(S)TRONG", "f(x)").
  clean = removeBracketGroups(clean);
  clean = clean.replace(/\s*\{[^}]*\}/g, '');

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

export const JUNK_SEGMENT_REGEX = /^(?:official\s*(?:video|audio|music\s*video|mv)?|m\/?v|lyric\s*video|visualizer|audio|video(?:\s*clip)?|full\s*hd|hd|4k|karaoke|vietsub|engsub|lossless|mv\s*hd|lyrics?|mp3|topic|lyrics?\s*mp3|mp3\s*lyrics?|nhạc\s*mp3|nhac\s*mp3)$/i;
export const VERSION_TAG_REGEX = /^(?:special\s*version|acoustic(?:\s*version)?|live(?:\s*performance|\s*version|\s*show|\s*session)?|instrumental|remix|slowed(?:\s*\+\s*reverb)?|speed\s*up|cover|original\s*mix|radio\s*edit|club\s*mix|extended\s*mix|[a-z]+\s+(?:ver|version)\.?)$/i;

/**
 * Helper to test if a segment is purely junk/blacklisted terms (e.g. "Lyrics Mp3", "Official MV", "Audio").
 */
export function isJunkSegment(seg) {
  if (!seg) return true;
  const s = seg.trim().toLowerCase();
  if (JUNK_SEGMENT_REGEX.test(s)) return true;
  const cleanedWords = s.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
  const junkWords = new Set(['lyrics', 'lyric', 'mp3', 'topic', 'audio', 'video', 'videoclip', 'clip', 'mv', 'hd', '4k', 'official', 'nhac', 'karaoke', 'vietsub', 'full', 'edm']);
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
    // Keep letters from every script (CJK, Cyrillic, Greek, ...), not just
    // ASCII \w. Dropping them made Japanese/Chinese artist names compare as an
    // empty string, which silently disabled artist matching for those tracks.
    .replace(/[^\p{L}\p{N}_\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Metadata "artists" that are really channels/brands/uploaders. Their presence
// is evidence the real performing artist lives inside the title instead.
export const UPLOADER_ARTIST_WORDS = new Set([
  'music', 'musics', 'edm', 'remix', 'remixes', 'vibes', 'vibe', 'chill',
  'chillout', 'mix', 'mixes', 'playlist', 'channel', 'official', 'records',
  'record', 'label', 'labels', 'vevo', 'ent', 'production', 'productions',
  'studio', 'entertainment', 'media', 'network', 'tv', 'radio', 'audio',
  'lyrics', 'lyric', 'song', 'songs', 'karaoke', 'nhac', 'tuyen', 'tong',
  'hop', 'tap',
]);

/**
 * True when an artist field looks like a channel/brand/uploader rather than the performing artist (e.g. "Music is Life - EDM", "Nhạc Chill TV").
 */
export function isUploaderLikeArtist(artist) {
  if (!artist || typeof artist !== 'string') return false;
  const tokens = tokenizeNormalized(artist);
  if (tokens.length === 0) return false;

  const significant = tokens.filter((token) => token.length >= 2);
  if (significant.length === 0) return false;

  const brandHits = significant.filter((token) => UPLOADER_ARTIST_WORDS.has(token)).length;
  return brandHits >= 2 || brandHits / significant.length >= 0.5;
}

// Words that strongly suggest a song title rather than a performer name. This
// is only used when the player supplied no artist and both sides of "A - B"
// could be either title or artist. "Rick Astley - Never Gonna Give You Up" has
// several title words on the right and none on the left, so the artist can be
// inferred without waiting for a network lookup. Articles and prepositions are
// deliberately omitted because they appear in artist names too ("The Weeknd",
// "Of Monsters and Men", "In Flames").
export const TITLE_SIGNAL_WORDS = new Set([
  'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'we', 'us', 'our', 'ours',
  'he', 'him', 'his', 'she', 'her', 'hers', 'they', 'them', 'their', 'it', 'its',
  'love', 'loved', 'loving', 'baby', 'girl', 'boy', 'heart', 'night', 'tonight',
  'day', 'days', 'never', 'always', 'gonna', 'wanna', 'gotta', 'give', 'take',
  'make', 'let', 'got', 'get', 'up', 'down', 'out', 'when', 'where', 'why',
  'how', 'what', 'who', 'if', 'but', 'not', 'no', 'do', 'does', 'did', 'is',
  'are', 'was', 'were', 'be', 'been', 'can', 'could', 'will', 'would', 'should',
  'dance', 'dancing', 'cry', 'crying', 'stay', 'go', 'going', 'gone', 'come',
  'coming', 'back', 'again', 'time', 'life', 'world', 'dream', 'dreams', 'feel',
  'feeling', 'want', 'need', 'know', 'say', 'said', 'tell', 'told', 'see',
  'seen', 'look', 'looking', 'wait', 'waiting', 'hold', 'holding', 'run',
  'running', 'walk', 'walking', 'away', 'home', 'alone', 'together', 'forever',
  'good', 'bad', 'right', 'wrong', 'first', 'last', 'free', 'true', 'real',
  'little', 'more', 'most', 'all', 'some', 'any',
  // Vietnamese title words, after normalizeText removes diacritics.
  'hay', 'em', 'anh', 'yeu', 'nguoi', 'di', 've', 'nho', 'thuong', 'mot',
  'hai', 'ba', 'dem', 'ngay', 'nay', 'do', 'kia', 'toi', 'minh', 'ta', 'chung',
  'ban', 'co', 'chu', 'con', 'tim', 'nuoc', 'mat', 'buon', 'vui', 'dau',
  'khoc', 'cuoi', 'xa', 'gan', 'mai', 'trong', 'ngoai', 'tren', 'duoi', 'voi',
  'khong', 'la', 'va', 'nhung', 'cho', 'de', 'khi', 'nao', 'sao', 'the', 'gian',
  'doi', 'tinh',
]);

export function countTitleSignalWords(text) {
  return tokenizeNormalized(text).filter((token) => TITLE_SIGNAL_WORDS.has(token)).length;
}

/**
 * Uses title-like vocabulary to choose between "Title - Artist" and
 * "Artist - Title" when no artist metadata is available. Returns null when
 * both readings are equally plausible.
 */
export function inferOrientationFromTitleLanguage(partA, partB) {
  const signalsA = countTitleSignalWords(partA);
  const signalsB = countTitleSignalWords(partB);
  if (signalsB - signalsA >= 2) return { title: partB, artist: partA };
  if (signalsA - signalsB >= 2) return { title: partA, artist: partB };
  return null;
}

/**
 * Removes trailing pipe-separated segments that merely repeat the metadata
 * artist or are uploader/channel brands: "Song - Artist | Music is Life - EDM"
 * becomes "Song - Artist". These labels are ubiquitous on YouTube rips and
 * would otherwise be mistaken for the artist or for part of the song title.
 */
export function stripRedundantArtistSegments(rawTitle, rawArtist) {
  if (!rawTitle || typeof rawTitle !== 'string') return rawTitle;

  const parts = rawTitle.split('|').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return rawTitle;

  const normalizedArtist = normalizeText(rawArtist || '');
  const artistIsUploaderLike = isUploaderLikeArtist(rawArtist);

  let lastIndex = parts.length - 1;
  while (lastIndex > 0) {
    const segment = parts[lastIndex];
    const duplicatesArtist = normalizedArtist && normalizeText(segment) === normalizedArtist;
    const looksLikeUploader = artistIsUploaderLike && isUploaderLikeArtist(segment);
    if (!duplicatesArtist && !looksLikeUploader) break;
    lastIndex -= 1;
  }

  if (lastIndex === parts.length - 1) return rawTitle;
  return parts.slice(0, lastIndex + 1).join(' | ') || parts[0];
}

/** True for letters/digits — detects brackets glued into a word ("(S)TRONG"). */
export function isWordChar(char) {
  return /[\p{L}\p{N}]/u.test(char);
}

/**
 * Removes bracket groups ("(...)", "[...]") while keeping groups embedded
 * inside a word: "(S)TRONG" and "f(x)" are identifiers, not credits.
 */
export function removeBracketGroups(text) {
  const stripped = text.replace(/[(\[][^()[\]]*[)\]]/g, (match, offset, whole) => {
    const before = offset === 0 ? '' : whole[offset - 1];
    const after = offset + match.length >= whole.length ? '' : whole[offset + match.length];
    return isWordChar(before) || isWordChar(after) ? match : '';
  });
  return stripped.replace(/\s{2,}/g, ' ');
}

/**
 * Splits a segment into credit parts, treating a non-embedded bracket group as
 * a delimiter: "Song (Artist)" → ["Song", "Artist"]. Embedded groups stay
 * attached ("(S)TRONG", "f(x)"). Feature chains like "feat. X" come back as
 * ordinary parts; callers decide whether to keep them.
 */
export function splitCreditParts(segment) {
  const pieces = segment
    .split(/\s+[-–—~•/_|:]\s+/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const parts = [];
  for (const piece of pieces) {
    const matcher = /[(\[][^()[\]]*[)\]]/g;
    let cursor = 0;
    let match;
    let sawBracket = false;
    while ((match = matcher.exec(piece)) !== null) {
      const before = match.index === 0 ? '' : piece[match.index - 1];
      const after = matcher.lastIndex >= piece.length ? '' : piece[matcher.lastIndex];
      if (isWordChar(before) || isWordChar(after)) continue;
      sawBracket = true;
      const outside = piece.slice(cursor, match.index).trim();
      if (outside) parts.push(outside);
      const inside = match[0].slice(1, -1).trim();
      if (inside) parts.push(inside);
      cursor = matcher.lastIndex;
    }
    if (!sawBracket) {
      parts.push(piece);
    } else {
      const tail = piece.slice(cursor).trim();
      if (tail) parts.push(tail);
    }
  }
  return parts;
}

/**
 * Content of the first non-embedded bracket group that is a pure version tag
 * ("(Acoustic Version)" in "Haru Haru (Acoustic Version)"), or null. The group
 * stays attached to the title; the tag only adds a version-targeted query and
 * boosts the correct version's candidates.
 */
export function findBracketVersionTag(text) {
  const matcher = /[(\[][^()[\]]*[)\]]/g;
  let match;
  while ((match = matcher.exec(text)) !== null) {
    const before = match.index === 0 ? '' : text[match.index - 1];
    const after = matcher.lastIndex >= text.length ? '' : text[matcher.lastIndex];
    if (isWordChar(before) || isWordChar(after)) continue;
    const inside = match[0].slice(1, -1).trim();
    if (inside && VERSION_TAG_REGEX.test(inside)) return inside;
  }
  return null;
}

/**
 * YouTube-style quote credit: "Artist 'Title'" / "BTS (방탄소년단) 'Hooligan'
 * Official MV". Returns { title, artist, versionTag } when a quoted span
 * unambiguously holds the song title, or null. Apostrophes inside words
 * ("Don't", "O' Mine") never qualify: the opening quote must follow
 * whitespace, no stray quote may remain after the closing one, and the text
 * after the closing quote must be empty, junk, a channel name, or a version
 * tag.
 */
export function extractQuoteCredit(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return null;
  const matcher = /(^|\s)['"‘’“”]([^'"‘’“”]{2,})['"‘’“”](?=\s|$)/g;
  let best = null;
  let match;
  while ((match = matcher.exec(rawTitle)) !== null) {
    const content = match[2].trim();
    if (!/[\p{L}\p{N}]/u.test(content)) continue;
    const after = rawTitle.slice(matcher.lastIndex);
    if (/['"‘’“”]/.test(after)) continue; // stray quote later: ambiguous
    const tailClean = cleanTrackTitle(after);
    const tailVersion = findBracketVersionTag(tailClean)
      || (VERSION_TAG_REGEX.test(tailClean) ? tailClean : null);
    const tailOk = !tailClean || isJunkSegment(tailClean)
      || isUploaderLikeArtist(tailClean) || Boolean(tailVersion);
    if (!tailOk) continue;
    const artist = rawTitle.slice(0, match.index + match[1].length).trim();
    best = { title: content, artist, versionTag: tailVersion };
  }
  return best;
}

/**
 * Splits a segment that pairs the title with the artist ("Title - Artist" or
 * "Artist - Title") and returns the title side. Returns null when the segment
 * is just the artist or the artist is not delimited at either end (so
 * "Artist feat. X" is not mistaken for "Artist" plus a title of "feat. X").
 */
export function extractTitleBesideArtist(segment, artist) {
  const normalizedArtist = normalizeText(artist);
  if (!normalizedArtist) return null;
  // Brackets count as credit delimiters too ("Song (Artist)"), except when
  // they are glued into a word ("(S)TRONG", "f(x)").
  const subparts = splitCreditParts(segment);
  if (subparts.length < 2) return null;

  const first = subparts[0];
  const last = subparts[subparts.length - 1];
  if (normalizeText(last) === normalizedArtist) {
    const remainder = subparts.slice(0, -1).join(' ').trim();
    if (remainder && !isJunkSegment(remainder)) return remainder;
  }
  if (normalizeText(first) === normalizedArtist) {
    const remainder = subparts.slice(1).join(' ').trim();
    if (remainder && !isJunkSegment(remainder)) return remainder;
  }
  return null;
}

/**
 * Returns the candidate's song title with a performer prefix/suffix removed.
 * LRCLIB entries frequently look like "Rick Astley - Never Gonna Give You Up"
 * and some report multiple artists ("Rick Astley, Rick Astley"). Without this,
 * the artist name itself could satisfy a title match and starve the real title.
 */
export function getCandidateTitle(candidate) {
  const name = candidate?.name || candidate?.trackName || '';
  const artist = candidate?.artistName || '';
  if (!name || !artist) return name;

  const artistVariants = new Set([artist]);
  for (const part of artist.split(/\s*(?:,|;|\/|&|\bfeat\.?\b|\bft\.?\b|\bwith\b)\s*/i)) {
    if (part.trim()) artistVariants.add(part.trim());
  }

  for (const variant of artistVariants) {
    const title = extractTitleBesideArtist(name, variant);
    if (title) return title;
  }
  return name;
}

/**
 * Iterative Levenshtein edit distance with two rolling rows (O(min(a,b)) extra
 * space). Powers the typo tolerance that lets misspelled filenames such as
 * "Wiz Khalfa - Se You Agin" still match "See You Again".
 */
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  // Iterate over the shorter string to keep the rolling rows small
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;

  let previousRow = Array.from({ length: short.length + 1 }, (_, index) => index);
  let currentRow = new Array(short.length + 1);

  for (let j = 1; j <= long.length; j += 1) {
    currentRow[0] = j;
    for (let i = 1; i <= short.length; i += 1) {
      const substitutionCost = short[i - 1] === long[j - 1] ? 0 : 1;
      currentRow[i] = Math.min(
        previousRow[i] + 1,
        currentRow[i - 1] + 1,
        previousRow[i - 1] + substitutionCost,
      );
    }
    const swap = previousRow;
    previousRow = currentRow;
    currentRow = swap;
  }

  return previousRow[short.length];
}

/**
 * Typo-tolerant similarity between two strings: 1 = identical, 0 = completely
 * different. Based on normalized Levenshtein distance — the "edit distance"
 * approach search engines use to forgive spelling mistakes.
 */
export function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  return Math.max(0, 1 - levenshteinDistance(a, b) / longest);
}

// Words of 1-3 characters must match exactly: allowing one edit on "of"/"on"
// or "7"/"?" turns distinct words into noisy false matches.
export const MIN_FUZZY_TOKEN_LENGTH = 4;
// Below this ratio a word pair counts as unrelated. "khalifa" vs "khalfa" is
// 0.857, while unrelated words of similar length rarely clear 0.78.
export const MIN_FUZZY_TOKEN_SIMILARITY = 0.78;

export function fuzzyTokenSimilarity(a, b) {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest < MIN_FUZZY_TOKEN_LENGTH) return 0;
  const similarity = stringSimilarity(a, b);
  return similarity >= MIN_FUZZY_TOKEN_SIMILARITY ? similarity : 0;
}

export function tokenizeNormalized(text) {
  const normalized = normalizeText(text);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

// Tokens that carry little discriminative signal in song metadata. They still
// count toward coverage, but at a fraction of a rare token's weight.
export const LOW_SIGNAL_TOKENS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'my', 'me', 'i', 'you', 'your', 'we', 'it', 'is', 'are', 'be', 'do', 'no',
  'not', 'so', 'up', 'all', 'oh', 'yeah', 'hey',
  'feat', 'ft', 'featuring', 'prod', 'produced', 'by',
  'official', 'video', 'audio', 'lyrics', 'lyric', 'mv', 'hd', '4k', 'topic',
  'music', 'song', 'version', 'remix', 'live', 'cover', 'instrumental',
]);

/**
 * Builds an IDF-style weight function over a candidate pool, mirroring the
 * TF-IDF/BM25 idea behind web search: a token found in many candidates
 * ("official", "remix", a common word) weighs little, while a token unique to
 * one candidate (an artist name) weighs the most and decides between lookalike
 * songs.
 */
export function createIdfWeightFn(candidateDocuments) {
  const documentFrequency = new Map();
  const documentCount = Math.max(1, candidateDocuments.length);

  for (const documentTokens of candidateDocuments) {
    for (const token of new Set(documentTokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }

  return (token) => {
    // Smoothed so unseen tokens still receive a weight instead of zero
    const frequency = documentFrequency.get(token) || 0;
    const rarity = Math.log(1 + (documentCount + 1) / (frequency + 1));
    return LOW_SIGNAL_TOKENS.has(token) ? rarity * 0.4 : rarity;
  };
}

/**
 * Inverted index over a batch of candidate token lists: token -> Set of
 * candidate indexes containing that token. Token lookups become hash lookups
 * into posting lists instead of scanning every candidate document, which is
 * what keeps the lexical pass fast on large candidate pools.
 */
export function createTokenInvertedIndex(candidateTokenLists = []) {
  const index = new Map();
  candidateTokenLists.forEach((tokens, docIndex) => {
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      let postings = index.get(token);
      if (!postings) {
        postings = new Set();
        index.set(token, postings);
      }
      postings.add(docIndex);
    }
  });
  return index;
}

/**
 * IDF-weighted, typo-tolerant coverage of target tokens by candidate tokens
 * (0..1, where 1 means every target token was matched). Without an IDF
 * function all tokens weigh equally.
 */
export function weightedTokenCoverage(targetTokens, candidateTokens, idfFn) {
  const uniqueTargets = [...new Set(targetTokens)];
  if (uniqueTargets.length === 0) return 0;

  const weightOf = idfFn || (() => 1);
  let matchedWeight = 0;
  let totalWeight = 0;

  for (const token of uniqueTargets) {
    const weight = weightOf(token);
    totalWeight += weight;

    let bestSimilarity = 0;
    for (const candidateToken of candidateTokens) {
      const similarity = fuzzyTokenSimilarity(token, candidateToken);
      if (similarity > bestSimilarity) bestSimilarity = similarity;
      if (bestSimilarity === 1) break;
    }
    matchedWeight += weight * bestSimilarity;
  }

  return totalWeight > 0 ? matchedWeight / totalWeight : 0;
}

/**
 * Scores how well an LRCLIB candidate matches the target track title, artist, and duration.
 * Uses typo-tolerant token matching with IDF (rarity) weighting when provided.
 * Returns -1 if the title similarity is too low (strictly preventing selection of wrong songs).
 */
export function scoreCandidate(candidate, targetTitle, targetArtist, targetDuration, extra = {}) {
  const normTargetTitle = normalizeText(targetTitle);
  // LRCLIB often stores the performer inside the candidate title
  // ("Rick Astley - Never Gonna Give You Up"). Strip that prefix before title
  // comparison so the artist name cannot masquerade as a matching song title.
  const candTitle = getCandidateTitle(candidate);
  const normCandTitle = normalizeText(candTitle);
  if (!normTargetTitle || !normCandTitle) return -1;

  const targetClean = normalizeText(stripExtraTitleDetails(targetTitle));
  const candClean = normalizeText(stripExtraTitleDetails(candTitle));

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
    const targetTokens = tokenizeNormalized(targetClean || normTargetTitle);
    const candidateTokens = tokenizeNormalized(candClean || normCandTitle);
    const coverage = weightedTokenCoverage(targetTokens, candidateTokens, extra.idfFn);
    const typoRatio = stringSimilarity(targetClean || normTargetTitle, candClean || normCandTitle);
    const ratio = Math.max(coverage, typoRatio);
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
        const artistTokens = tokenizeNormalized(normTargetArtist);
        const candidateArtistTokens = tokenizeNormalized(candidate.artistName);
        let matchedSimilarity = 0;
        for (const token of artistTokens) {
          let bestSimilarity = 0;
          for (const candidateToken of candidateArtistTokens) {
            const similarity = fuzzyTokenSimilarity(token, candidateToken);
            if (similarity > bestSimilarity) bestSimilarity = similarity;
          }
          matchedSimilarity += bestSimilarity;
        }
        const artistRatio = artistTokens.length > 0 ? matchedSimilarity / artistTokens.length : 0;
        // Near-identical with a spelling fix ("Khalfa" → "Khalifa") is as much
        // evidence as a substring match; a wholly different artist is negative
        // evidence, preventing a common title (or an artist name that is also
        // a song title) from winning solely because LRCLIB returned it first.
        if (artistRatio >= 0.85) totalScore += 35 * artistRatio;
        else if (artistRatio > 0) totalScore += 25 * artistRatio;
        else totalScore -= 30;
      }
    }
  }

  if (extra.versionTag) {
    // Providers spell versions differently ("Acoustic Ver." vs "Acoustic
    // Version"), so score on the distinctive tokens instead of the exact phrase.
    const versionTokens = tokenizeNormalized(extra.versionTag)
      .filter((token) => token.length >= 3 && token !== 'version' && token !== 'the');
    if (versionTokens.length > 0) {
      const candWordTokens = new Set(tokenizeNormalized(candTitle));
      const matchedVersionTokens = versionTokens.filter((token) => candWordTokens.has(token)).length;
      if (matchedVersionTokens === versionTokens.length) totalScore += 20;
      else if (matchedVersionTokens > 0) totalScore += 10;
    }
  }

  // A candidate carrying a version marker the target does not ask for (a
  // cover, a karaoke track) is fine to offer in search results but must never
  // win the automatic match — its vocalist and timing differ from the track.
  const candidateNameTokens = new Set(tokenizeNormalized(candTitle));
  const targetTitleTokens = new Set(tokenizeNormalized(targetTitle));
  for (const marker of ['cover', 'karaoke']) {
    if (candidateNameTokens.has(marker) && !targetTitleTokens.has(marker)) totalScore -= 20;
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

export function scoreFreeformSearchCandidate(candidate, query, duration, idfFn) {
  const normalizedQuery = normalizeText(query);
  const title = normalizeText(getCandidateTitle(candidate));
  const artist = normalizeText(candidate.artistName || '');
  if (!normalizedQuery || (!title && !artist)) return -1;

  let score = 0;
  if (normalizedQuery === title || normalizedQuery === artist) score = 100;
  else if (title.includes(normalizedQuery) || artist.includes(normalizedQuery)) score = 80;
  else {
    const queryTokens = tokenizeNormalized(normalizedQuery);
    // Whole-label queries include the artist, but only title tokens should
    // count here. Otherwise every song by the same artist receives free points
    // even when its title is unrelated to what the user searched for.
    const candidateTokens = tokenizeNormalized(title);
    const coverage = weightedTokenCoverage(queryTokens, candidateTokens, idfFn);
    const typoRatio = stringSimilarity(normalizedQuery, title);
    const ratio = Math.max(coverage, typoRatio);
    score = ratio >= 0.5 ? ratio * 60 : 0;
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
 * Scores how well an LRCLIB candidate matches the target track title, artist, and duration.
 * Uses typo-tolerant token matching with IDF (rarity) weighting when provided.
 * Returns -1 if the title similarity is too low (strictly preventing selection of wrong songs).
 */
export function scoreSearchCandidate(candidate, target, duration, idfFn) {
  const targetTitle = target.title || '';
  const targetArtist = target.artist || '';
  const normTargetTitle = normalizeText(targetTitle);
  const candTitle = getCandidateTitle(candidate);
  const normCandTitle = normalizeText(candTitle);

  let titleScore = 0;
  if (normTargetTitle && normCandTitle) {
    const targetClean = normalizeText(stripExtraTitleDetails(targetTitle));
    const candClean = normalizeText(stripExtraTitleDetails(candTitle));
    if (normTargetTitle === normCandTitle || (targetClean && targetClean === candClean)) {
      titleScore = 100;
    } else if (normCandTitle.startsWith(normTargetTitle) || normTargetTitle.startsWith(normCandTitle) ||
               (targetClean && (candClean.startsWith(targetClean) || targetClean.startsWith(candClean)))) {
      titleScore = 85 * searchTitleDominance(normTargetTitle, normCandTitle);
    } else if (normCandTitle.includes(normTargetTitle) || normTargetTitle.includes(normCandTitle) ||
               (targetClean && (candClean.includes(targetClean) || targetClean.includes(candClean)))) {
      titleScore = 75 * searchTitleDominance(normTargetTitle, normCandTitle);
    } else {
      const targetTokens = tokenizeNormalized(targetClean || normTargetTitle);
      const candidateTokens = tokenizeNormalized(candClean || normCandTitle);
      const coverage = weightedTokenCoverage(targetTokens, candidateTokens, idfFn);
      const typoRatio = stringSimilarity(targetClean || normTargetTitle, candClean || normCandTitle);
      const ratio = Math.max(coverage, typoRatio);
      if (ratio >= 0.5) titleScore = 60 * ratio;
    }
  }

  // A matching artist must not rescue a candidate whose title is unrelated.
  // Artist-only searches still work through the freeform scorer above.
  if (normTargetTitle && titleScore === 0) return 0;

  let totalScore = titleScore;

  if (targetArtist && candidate.artistName) {
    const normTargetArtist = normalizeText(targetArtist);
    const normCandArtist = normalizeText(candidate.artistName);
    if (normTargetArtist && normCandArtist) {
      if (normTargetArtist === normCandArtist) {
        totalScore += 50;
      } else if (normCandArtist.includes(normTargetArtist) || normTargetArtist.includes(normCandArtist)) {
        totalScore += 35;
      } else {
        const artistTokens = tokenizeNormalized(normTargetArtist);
        const candidateArtistTokens = tokenizeNormalized(candidate.artistName);
        let matchedSimilarity = 0;
        for (const token of artistTokens) {
          let bestSimilarity = 0;
          for (const candidateToken of candidateArtistTokens) {
            bestSimilarity = Math.max(bestSimilarity, fuzzyTokenSimilarity(token, candidateToken));
          }
          matchedSimilarity += bestSimilarity;
        }
        const artistRatio = artistTokens.length > 0 ? matchedSimilarity / artistTokens.length : 0;
        if (artistRatio > 0) totalScore += 35 * artistRatio;
      }
    }
  }

  if (duration > 0 && candidate.duration > 0) {
    const difference = Math.abs(candidate.duration - duration);
    if (difference <= 5) totalScore += 10;
    else if (difference <= 20) totalScore += 5;
  }
  if (candidate.syncedLyrics) totalScore += 5;

  return totalScore;
}

/**
 * Scores how well an LRCLIB candidate matches the target track title, artist, and duration.
 * Uses typo-tolerant token matching with IDF (rarity) weighting when provided.
 * Returns -1 if the title similarity is too low (strictly preventing selection of wrong songs).
 */
export function searchTitleDominance(normTargetTitle, normCandTitle) {
  const targetTokens = new Set(tokenizeNormalized(normTargetTitle));
  const candidateTokens = tokenizeNormalized(normCandTitle);
  if (targetTokens.size === 0 || candidateTokens.length === 0) return 0.5;
  const explained = candidateTokens.filter((token) => targetTokens.has(token)).length;
  return 0.5 + 0.5 * (explained / candidateTokens.length);
}

/**
 * Runs the full lexical ranking pipeline for a candidate batch: builds the
 * inverted token index, derives IDF weights from the posting lists and returns
 * the candidates sorted by best match. Pure — safe to call from a Web Worker.
 */
export function scoreLyricsCandidates({ candidates = [], query = '', duration = 0, targets = [] } = {}) {
  const candidateTokenLists = candidates.map((candidate) =>
    tokenizeNormalized(`${getCandidateTitle(candidate)} ${candidate?.artistName || ''}`),
  );
  const tokenIndex = createTokenInvertedIndex(candidateTokenLists);
  const idfFn = createIdfWeightFn(candidateTokenLists);

  const entries = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      durationDelta: duration > 0 && candidate.duration > 0
        ? Math.abs(candidate.duration - duration)
        : Number.MAX_SAFE_INTEGER,
      score: Math.max(
        scoreFreeformSearchCandidate(candidate, query, duration, idfFn),
        ...targets.map((target) => scoreSearchCandidate(candidate, target, duration, idfFn)),
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.durationDelta - right.durationDelta ||
        left.index - right.index,
    );

  // Expose the posting lists next to the scores so callers can reuse the
  // inverted index for follow-up token lookups without rebuilding it.
  return { entries, tokenIndex, candidateTokenLists };
}
