import { invoke } from '@tauri-apps/api/core';

export const TAURI_PROXY_ORIGIN = 'http://127.0.0.1:18765';

const MEDIA_PROXY_BASE = String(import.meta.env.VITE_MEDIA_PROXY || '').trim();

export function isTauriRuntime() {
  return typeof window !== 'undefined'
    && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

/**
 * Route desktop requests through the Rust proxy, and browser dev requests
 * through Vite's `/__media` middleware so requests stay same-origin and avoid
 * CORS. In static production builds (e.g. GitHub Pages), leave URLs untouched
 * unless `VITE_MEDIA_PROXY` is configured so `--disable-web-security` or
 * CORS-enabled servers still hit the target directly instead of 404ing.
 */
export function proxyServerUrl(url) {
  const value = String(url || '').trim();
  if (!value || !/^https?:\/\//i.test(value)) return value;
  if (isTauriRuntime()) {
    return `${TAURI_PROXY_ORIGIN}/proxy?url=${encodeURIComponent(value)}`;
  }
  if (MEDIA_PROXY_BASE) {
    const sep = MEDIA_PROXY_BASE.includes('?') ? '&' : '?';
    return `${MEDIA_PROXY_BASE.replace(/[?&]$/, '')}${sep}url=${encodeURIComponent(value)}`;
  }
  if (import.meta.env.DEV) {
    return `/__media?url=${encodeURIComponent(value)}`;
  }
  return value;
}

const ZOOM_STORAGE_KEY = 'localstream_desktop_zoom';
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

function clampZoom(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, num)) * 100) / 100;
}

function loadSavedZoom() {
  try {
    const raw = window.localStorage.getItem(ZOOM_STORAGE_KEY);
    return raw ? clampZoom(parseFloat(raw)) : 1;
  } catch {
    return 1;
  }
}

function saveZoom(factor) {
  try {
    if (factor === 1) {
      window.localStorage.removeItem(ZOOM_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ZOOM_STORAGE_KEY, String(factor));
    }
  } catch {
    // ignore storage errors
  }
}

function unwrapProxiedUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''), window.location.href);
    if (
      (parsed.origin === TAURI_PROXY_ORIGIN && parsed.pathname === '/proxy')
      || parsed.pathname === '/__media'
    ) {
      const inner = parsed.searchParams.get('url');
      if (inner && /^https?:\/\//i.test(inner)) {
        return inner;
      }
    }
    return parsed.href;
  } catch {
    return String(rawUrl || '');
  }
}

export function openExternalUrl(rawUrl) {
  if (!rawUrl || !isTauriRuntime()) return false;
  const target = unwrapProxiedUrl(rawUrl);
  if (!/^(?:https?|mailto|tel):/i.test(target)) return false;
  invoke('open_external_url', { url: target }).catch((err) => {
    console.error('Failed to open external URL:', err);
  });
  return true;
}

export function createDesktopBridge() {
  if (typeof window === 'undefined' || !isTauriRuntime()) return;
  if (window.__LOCALSTREAM_DESKTOP_BRIDGE_READY__) return;
  window.__LOCALSTREAM_DESKTOP_BRIDGE_READY__ = true;

  // Never use CSS `document.documentElement.style.zoom` in Tauri: CSS zoom
  // shrinks/expands 100vw & 100dvh boxes inside the window instead of scaling
  // the WebView viewport like Electron's `webContents.setZoomFactor`.
  document.documentElement.style.removeProperty('zoom');

  let currentZoom = loadSavedZoom();
  const applyZoom = (nextFactor) => {
    const target = clampZoom(nextFactor);
    currentZoom = target;
    document.documentElement.style.removeProperty('zoom');
    saveZoom(target);
    invoke('set_webview_zoom', { factor: target }).catch(() => {});
  };

  if (currentZoom !== 1) {
    applyZoom(currentZoom);
  }

  if (!window.electronZoom) {
    window.electronZoom = {
      zoomIn: () => applyZoom(currentZoom + ZOOM_STEP),
      zoomOut: () => applyZoom(currentZoom - ZOOM_STEP),
      zoomReset: () => applyZoom(1),
    };
  }
  if (!window.electronLyrics) {
    window.electronLyrics = {
      innertube: (payload) => invoke('ytmusic_innertube', payload),
    };
  }

  // Route external links (<a target="_blank">, cross-origin links, mailto:, and
  // window.open) to the user's default system browser, matching Electron's
  // setWindowOpenHandler + shell.openExternal behavior.
  const originalWindowOpen = window.open?.bind(window);
  window.open = (url, target, features) => {
    if (url != null && openExternalUrl(String(url))) {
      return null;
    }
    return originalWindowOpen ? originalWindowOpen(url, target, features) : null;
  };

  const handleExternalAnchorEvent = (event) => {
    if (event.defaultPrevented) return;
    if (event.type === 'auxclick' && event.button !== 1) return;
    const targetEl = event.target;
    if (!targetEl || typeof targetEl.closest !== 'function') return;

    const anchor = targetEl.closest('a[href]');
    if (!anchor || anchor.hasAttribute('download')) return;

    const rawHref = (anchor.getAttribute('href') || '').trim();
    if (!rawHref || rawHref.startsWith('#') || /^(?:blob|data|javascript):/i.test(rawHref)) {
      return;
    }

    if (/^(?:mailto|tel):/i.test(rawHref)) {
      event.preventDefault();
      event.stopPropagation();
      openExternalUrl(rawHref);
      return;
    }

    let resolved;
    try {
      resolved = new URL(rawHref, window.location.href);
    } catch {
      return;
    }

    if (!/^https?:$/i.test(resolved.protocol)) return;

    const isBlankTarget = String(anchor.getAttribute('target') || '').toLowerCase() === '_blank';
    const isExternalOrigin = resolved.origin !== window.location.origin;

    if (isBlankTarget || isExternalOrigin) {
      event.preventDefault();
      event.stopPropagation();
      openExternalUrl(resolved.href);
    }
  };

  document.addEventListener('click', handleExternalAnchorEvent, true);
  document.addEventListener('auxclick', handleExternalAnchorEvent, true);

  // Sync HTML5 element fullscreen (e.g. VideoPage fullscreen) with the native
  // OS Tauri window fullscreen state, matching Electron's BrowserWindow behavior.
  let nativeFullscreenActive = false;
  document.addEventListener('fullscreenchange', () => {
    const isDomFullscreen = Boolean(document.fullscreenElement);
    if (isDomFullscreen !== nativeFullscreenActive) {
      nativeFullscreenActive = isDomFullscreen;
      invoke('set_window_fullscreen', { fullscreen: isDomFullscreen }).catch(() => {});
    }
  });
}
