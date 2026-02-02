import React, { useState, useEffect } from 'react';
import ConnectPage from './ConnectPage.jsx';
import MediaPage from './MediaPage.jsx';

const STORAGE_KEY = 'localstream_server_url';

export default function App() {
  const [serverUrl, setServerUrl] = useState('');
  const [path, setPath] = useState(() => window.location.pathname || '/');

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
    setServerUrl(url);
    navigate('/media');
  }

  function handleChangeServer() {
    setServerUrl('');
    navigate('/');
  }

  const isConnected = !!serverUrl;
  const atMediaRoute = path.startsWith('/media');

  // Landing page (connect) is shown whenever we're not on /media,
  // regardless of whether a server URL is already stored.
  if (!atMediaRoute || !isConnected) {
    return <ConnectPage onConnected={handleConnected} />;
  }

  return (
    <MediaPage
      serverUrl={serverUrl}
      onChangeServer={handleChangeServer}
    />
  );
}
