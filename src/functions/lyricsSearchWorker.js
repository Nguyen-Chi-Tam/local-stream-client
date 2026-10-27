import { scoreLyricsCandidates } from './lyricsSearchEngine.js';

/**
 * Lexical lyrics search scoring runs on its own worker thread. The Electron
 * and browser UIs are single-threaded; ranking a candidate batch against a
 * query is pure CPU work, so keeping it off the main thread guarantees the
 * search box, results list and player stay responsive while scores compute.
 */
self.onmessage = (event) => {
  const { candidates = [], query = '', duration = 0, targets = [] } = event.data || {};
  const { entries } = scoreLyricsCandidates({ candidates, query, duration, targets });
  self.postMessage({ entries });
};

export {};
