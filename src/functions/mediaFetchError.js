export const STRICT_HTTP_SERVER_REGEX = /^http:\/\/(?:(?:\d{1,3}\.){3}\d{1,3}|localhost):\d{1,5}$/;

export function isDesktopClient() {
  return (
    (typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)) ||
    (typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__))
  );
}

export function isLoopbackHostname(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  return /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/.test(host);
}

/**
 * Returns true when an HTTPS web page would attempt to fetch an insecure
 * non-loopback `http://` server URL, which browsers block as mixed content.
 */
export function isMixedContentUrl(targetUrl, options = {}) {
  const {
    pageProtocol = typeof window !== 'undefined' ? window.location?.protocol : '',
    isDesktop = isDesktopClient(),
  } = options;

  if (isDesktop) return false;
  if (String(pageProtocol || '').toLowerCase() !== 'https:') return false;

  const trimmed = String(targetUrl || '').trim();
  if (!/^http:\/\//i.test(trimmed)) return false;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:') return false;
    return !isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Builds an HTTP version of the current page URL when served over HTTPS,
 * preserving the valid server URL in the hash so origin-scoped storage
 * does not lose the user's connection target on switch.
 */
export function getHttpSwitchUrl(serverUrl, options = {}) {
  const locationObj =
    options.locationObj !== undefined
      ? options.locationObj
      : typeof window !== 'undefined'
        ? window.location
        : null;

  if (!locationObj || String(locationObj.protocol || '').toLowerCase() !== 'https:') {
    return null;
  }

  const host = String(locationObj.host || '').trim();
  if (!host) return null;

  const pathname = locationObj.pathname || '/';
  const search = locationObj.search || '';
  const trimmedServer = String(serverUrl || '').trim().replace(/\/$/, '');
  const hash = STRICT_HTTP_SERVER_REGEX.test(trimmedServer)
    ? `#server=${encodeURIComponent(trimmedServer)}`
    : '';

  return `http://${host}${pathname}${search}${hash}`;
}

export function extractServerFromHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return '';
  try {
    const params = new URLSearchParams(raw);
    const candidate = String(params.get('server') || '').trim().replace(/\/$/, '');
    return STRICT_HTTP_SERVER_REGEX.test(candidate) ? candidate : '';
  } catch {
    return '';
  }
}

/**
 * Classifies a failed media fetch into an actionable user-facing category.
 */
export function classifyMediaLoadError(error, options = {}) {
  const {
    serverUrl = '',
    endpoint = '',
    requestUrl = '',
    pageProtocol,
    isDesktop,
    locationObj,
  } = options;

  const base = String(serverUrl || '').trim().replace(/\/$/, '');
  const displayEndpoint = endpoint || (base ? `${base}/api/media` : 'the LocalStream server');
  const effectiveRequestUrl = requestUrl || endpoint || serverUrl;

  if (isMixedContentUrl(effectiveRequestUrl, { pageProtocol, isDesktop })) {
    const httpSwitchUrl = getHttpSwitchUrl(serverUrl, { locationObj });
    return {
      kind: 'mixed-content',
      message:
        `Blocked by browser mixed-content rules: this page is loaded over HTTPS while ${base || 'your server'} uses HTTP. ` +
        'Open the HTTP version of this site or use the desktop app.',
      httpSwitchUrl,
    };
  }

  if (
    error?.code === 'TIMEOUT' ||
    error?.name === 'TimeoutError' ||
    error?.name === 'AbortError'
  ) {
    return {
      kind: 'timeout',
      message:
        `Connection to ${displayEndpoint} timed out. Make sure LocalStream is running, ` +
        'the IP/port is correct, and both devices are on the same network.',
      httpSwitchUrl: null,
    };
  }

  if (Number.isFinite(error?.status) || error?.code === 'HTTP_ERROR') {
    const statusText = Number.isFinite(error?.status) ? `HTTP ${error.status}` : 'an error response';
    return {
      kind: 'http',
      message:
        `LocalStream at ${displayEndpoint} returned ${statusText}. ` +
        'Make sure the LocalStream server is running properly.',
      httpSwitchUrl: null,
    };
  }

  return {
    kind: 'network',
    message:
      `Could not reach ${displayEndpoint}. Make sure LocalStream is running, ` +
      'both devices are on the same network, CORS is enabled, and local network access is allowed.',
    httpSwitchUrl: null,
  };
}

export function logMediaLoadError(endpoint, error, classified) {
  const label = classified?.kind ? ` (${classified.kind})` : '';
  const detail = error?.message || String(error || 'Unknown error');
  console.warn(`[LocalStream] Failed to load media from ${endpoint || 'server'}${label}: ${detail}`);
}
