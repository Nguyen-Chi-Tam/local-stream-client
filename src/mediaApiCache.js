const CACHE_TTL_MS = 2 * 60 * 1000;

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
  if (!serverUrl) {
    // If no URL provided, clear all cache
    mediaCache.clear();
    return;
  }

  // Clear cache for a specific server URL
  const endpoint = getMediaEndpoint(serverUrl);
  if (endpoint) {
    mediaCache.delete(endpoint);
  }
}

export async function fetchMediaItemsCached(serverUrl, options = {}) {
  const { force = false } = options;
  const endpoint = getMediaEndpoint(serverUrl);
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

  const pending = fetch(endpoint, {
    headers: { Accept: 'application/json' },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error('Server responded with ' + response.status);
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
      throw error;
    });

  mediaCache.set(endpoint, {
    items: existing && Array.isArray(existing.items) ? existing.items : null,
    fetchedAt: existing && existing.fetchedAt ? existing.fetchedAt : 0,
    promise: pending,
  });

  return pending;
}
