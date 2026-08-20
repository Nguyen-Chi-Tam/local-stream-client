import React, { useState, useEffect } from 'react';
import ConnectPage from './pages/ConnectPage.jsx';
import MediaPage from './pages/MediaPage.jsx';
import VideoPage from './pages/VideoPage.jsx';
import PhotoPage from './pages/PhotoPage.jsx';
import QueueToast from './components/QueueToast.jsx';
import { clearMediaCache } from './functions/mediaApiCache.js';

const STORAGE_KEY = 'localstream_server_url';
const BASE_URL = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
const APP_BASE = BASE_URL && BASE_URL !== '.' ? BASE_URL : '';

function stripBasePath(pathname) {
  const raw = pathname || '/';
  if (!APP_BASE) return raw || '/';

  if (raw === APP_BASE) return '/';
  if (raw.startsWith(APP_BASE + '/')) {
    return raw.slice(APP_BASE.length) || '/';
  }

  return raw;
}

function withBasePath(pathname) {
  const normalized = pathname && pathname.startsWith('/') ? pathname : '/';
  return APP_BASE ? `${APP_BASE}${normalized}` : normalized;
}

export default function App() {
  const [serverUrl, setServerUrl] = useState('');
  const [path, setPath] = useState(() => {
    try {
      const redirect = window.sessionStorage.getItem('spa_redirect');
      if (redirect) {
        window.sessionStorage.removeItem('spa_redirect');
        window.history.replaceState({}, '', redirect);
        return stripBasePath(redirect);
      }
    } catch (e) {}
    return stripBasePath(window.location.pathname);
  });

  // Keyboard zoom shortcut handling for Electron
  useEffect(() => {
    function handleZoomKeys(e) {
      if (!window.electronZoom) return;
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.key === '+' || e.key === '=') {
          window.electronZoom.zoomIn();
          e.preventDefault();
        } else if (e.key === '-') {
          window.electronZoom.zoomOut();
          e.preventDefault();
        } else if (e.key === '0') {
          window.electronZoom.zoomReset();
          e.preventDefault();
        }
      }
    }
    window.addEventListener('keydown', handleZoomKeys);
    return () => window.removeEventListener('keydown', handleZoomKeys);
  }, []);

  function getSectionFromPath(rawPath) {
    if (rawPath === '/media/video') return 'video';
    if (rawPath === '/media/photo/view') return 'photo-view';
    if (rawPath === '/media/photo') return 'photo';
    if (rawPath === '/media') return 'music';
    return '';
  }

  useEffect(() => {
    try {
      const existing = window.localStorage.getItem(STORAGE_KEY) || '';
      if (existing) {
        setServerUrl(existing);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    function handlePopState() {
      setPath(stripBasePath(window.location.pathname));
    }

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  function navigate(to) {
    const normalized = to || '/';
    const destination = withBasePath(normalized);

    if (window.location.pathname !== destination) {
      window.history.pushState({}, '', destination);
    }
    setPath(normalized);
  }

  function handleConnected(url) {
    clearMediaCache();
    setServerUrl(url);
    navigate('/media');
  }

  function handleChangeServer() {
    try {
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        if (typeof document.exitFullscreen === 'function') {
          document.exitFullscreen().catch(() => {});
        } else if (typeof document.webkitExitFullscreen === 'function') {
          document.webkitExitFullscreen();
        }
      }
    } catch {}
    clearMediaCache();
    setServerUrl('');
    navigate('/');
  }

  const isConnected = !!serverUrl;
  const section = getSectionFromPath(path);

  // Update document.title based on connection state
  useEffect(() => {
    if (isConnected && section) {
      document.title = 'Media \u2013 LocalStream Client';
    } else {
      document.title = 'LocalStream Client';
    }
  }, [isConnected, section]);

  let pageContent = null;
  if (!section || !isConnected) {
    pageContent = <ConnectPage onConnected={handleConnected} />;
  } else if (section === 'music') {
    pageContent = (
      <MediaPage
        serverUrl={serverUrl}
        onChangeServer={handleChangeServer}
        onNavigate={navigate}
      />
    );
  } else if (section === 'video') {
    pageContent = (
      <VideoPage
        serverUrl={serverUrl}
        onChangeServer={handleChangeServer}
        onNavigate={navigate}
      />
    );
  } else if (section === 'photo' || section === 'photo-view') {
    pageContent = (
      <PhotoPage
        serverUrl={serverUrl}
        onChangeServer={handleChangeServer}
        onNavigate={navigate}
        isViewOpen={section === 'photo-view'}
      />
    );
  }

  return (
    <>
      {pageContent}
      {isConnected && <QueueToast />}
    </>
  );
}
