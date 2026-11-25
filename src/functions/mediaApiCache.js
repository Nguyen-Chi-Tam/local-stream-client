import { clearQueue } from './queueService.js';
import { proxyServerUrl } from './desktopBridge.js';

const CACHE_TTL_MS = 2 * 60 * 1000;
export const MEDIA_FETCH_TIMEOUT_MS = 8000;

const mediaCache = new Map();

function extractItems(data) {
  if (Array.isArray(data)) return data;
  return data.items || data.files || data.tracks || data.audio || [];
}

export function getMediaEndpoint(serverUrl) {
  const base = String(serverUrl || '').replace(/\/$/, '');
  return base ? base + '/api/media' : '';
}

export function clearMediaCache(serverUrl) {
  clearQueue();
  if (!serverUrl) {
    // If no URL provided, clear all cache
    mediaCache.clear();
    return;
  }

  // Clear cache for a specific server URL
  const endpoint = proxyServerUrl(getMediaEndpoint(serverUrl));
  if (endpoint) {
    mediaCache.delete(endpoint);
  }
}

export function getCachedMediaItems(serverUrl, options = {}) {
  const { staleOk = false } = options;
  const endpoint = proxyServerUrl(getMediaEndpoint(serverUrl));
  if (!endpoint) return null;

  const now = Date.now();
  const existing = mediaCache.get(endpoint);
  if (!existing || !Array.isArray(existing.items)) return null;

  if (staleOk) {
    return existing.items;
  }

  if (now - existing.fetchedAt < CACHE_TTL_MS) {
    return existing.items;
  }

  return null;
}

export async function fetchMediaItemsCached(serverUrl, options = {}) {
  const { force = false, timeoutMs = MEDIA_FETCH_TIMEOUT_MS } = options;
  const endpoint = proxyServerUrl(getMediaEndpoint(serverUrl));
  if (!endpoint) return [];

  const now = Date.now();
  const existing = mediaCache.get(endpoint);

  if (!force && existing && Array.isArray(existing.items)) {
    if (now - existing.fetchedAt < CACHE_TTL_MS) {
      return existing.items;
    }
  }

  if (!force && existing && existing.promise) {
    return existing.promise;
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  const timer =
    controller && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;

  const pending = fetch(endpoint, {
    headers: { Accept: 'application/json' },
    ...(controller ? { signal: controller.signal } : {}),
  })
    .then((response) => {
      if (!response.ok) {
        const httpError = new Error('Server responded with ' + response.status);
        httpError.status = response.status;
        httpError.code = 'HTTP_ERROR';
        throw httpError;
      }
      return response.json();
    })
    .then((data) => {
      const items = extractItems(data);
      mediaCache.set(endpoint, {
        items,
        fetchedAt: Date.now(),
        promise: null,
      });
      return items;
    })
    .catch((error) => {
      const current = mediaCache.get(endpoint);
      if (current) {
        mediaCache.set(endpoint, {
          ...current,
          promise: null,
        });
      }
      if (timedOut || error?.name === 'AbortError') {
        const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
        timeoutError.name = 'TimeoutError';
        timeoutError.code = 'TIMEOUT';
        timeoutError.requestUrl = endpoint;
        throw timeoutError;
      }
      if (error && typeof error === 'object' && !error.requestUrl) {
        error.requestUrl = endpoint;
      }
      throw error;
    })
    .finally(() => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    });

  mediaCache.set(endpoint, {
    items: existing && Array.isArray(existing.items) ? existing.items : null,
    fetchedAt: existing && existing.fetchedAt ? existing.fetchedAt : 0,
    promise: pending,
  });

  return pending;
}
