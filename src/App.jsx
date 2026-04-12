import React, { useState, useEffect } from 'react';
import ConnectPage from './ConnectPage.jsx';
import MediaPage from './MediaPage.jsx';
import VideoPage from './VideoPage.jsx';
import PhotoPage from './PhotoPage.jsx';
import { clearMediaCache } from './mediaApiCache.js';

const STORAGE_KEY = 'localstream_server_url';

export default function App() {
  const [serverUrl, setServerUrl] = useState('');
  const [path, setPath] = useState(() => window.location.pathname || '/');

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
      setPath(window.location.pathname || '/');
    }

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  function navigate(to) {
    const normalized = to || '/';
    if (window.location.pathname !== normalized) {
      window.history.pushState({}, '', normalized);
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
