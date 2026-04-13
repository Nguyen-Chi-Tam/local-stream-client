import React, { useState, useEffect } from 'react';
import ConnectPage from './ConnectPage.jsx';
import MediaPage from './MediaPage.jsx';
import VideoPage from './VideoPage.jsx';
import PhotoPage from './PhotoPage.jsx';
import { clearMediaCache } from './mediaApiCache.js';

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
  const [path, setPath] = useState(() => stripBasePath(window.location.pathname));

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
    clearMediaCache();
    setServerUrl('');
    navigate('/');
  }

  const isConnected = !!serverUrl;
  const section = getSectionFromPath(path);

  // Landing page (connect) is shown whenever we're not on /media,
  // regardless of whether a server URL is already stored.
  if (!section || !isConnected) {
    return <ConnectPage onConnected={handleConnected} />;
  }

  if (section === 'music') {
    return (
      <MediaPage
        serverUrl={serverUrl}
        onChangeServer={handleChangeServer}
        onNavigate={navigate}
      />
    );
  }

  if (section === 'video') {
    return (
      <VideoPage
        serverUrl={serverUrl}
        onChangeServer={handleChangeServer}
        onNavigate={navigate}
      />
    );
  }

  return (
    <PhotoPage
      serverUrl={serverUrl}
      onChangeServer={handleChangeServer}
      onNavigate={navigate}
    />
  );
}
