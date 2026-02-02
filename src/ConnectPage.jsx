import React, { useState } from 'react';

const STORAGE_KEY = 'localstream_server_url';

function normalizeUrl(raw) {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return 'http://' + trimmed;
  }
  return trimmed.replace(/\/$/, '');
}

export default function ConnectPage({ onConnected }) {
  const [value, setValue] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [error, setError] = useState('');

  function handleSubmit(event) {
    event.preventDefault();
    setError('');

    const url = normalizeUrl(value);
    try {
      // Validate URL format
      // eslint-disable-next-line no-new
      new URL(url);
    } catch (e) {
      setError('Please enter a valid http/https URL.');
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, url);
    } catch {
      // ignore storage failures
    }

    onConnected(url);
  }

  return (
    <main className="page">
      <section className="card full connect-card">
        <div className="connect-layout mb-10">
          <div className="connect-left">
            <div className="connect-pill">LocalStream Client</div>
            <h1>Connect and stream your personal music library.</h1>
            <p className="subtitle">
              Point this client at your LocalStream server and instantly browse your albums,
              playlists, and tracks from the browser.
            </p>

            <ul className="connect-feature-list">
              <li>
                <span className="connect-feature-title">Fast library browsing</span>
                <span className="connect-feature-desc">Search, filter and jump between artists without leaving the page.</span>
              </li>
              <li>
                <span className="connect-feature-title">High‑quality streaming</span>
                <span className="connect-feature-desc">Stream directly from your own machine — no cloud uploads.</span>
              </li>
              <li>
                <span className="connect-feature-title">Private by design</span>
                <span className="connect-feature-desc">Your server URL is stored locally in this browser only.</span>
              </li>
            </ul>
          </div>

          <div className="connect-right">
            <div className="connect-panel">
              <h2>Connect to your server</h2>
              <p className="connect-panel-subtitle">
                Paste the <strong>Main Server URL</strong> from the LocalStream desktop/mobile app.
              </p>

              <form id="server-form" className="form" onSubmit={handleSubmit}>
                <label htmlFor="server-url">LocalStream server address</label>
                <input
                  id="server-url"
                  name="server-url"
                  type="url"
                  placeholder="e.g. http://192.168.1.11:8080"
                  required
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
                <p className="hint">
                  This value never leaves your device — it&apos;s stored in your browser only.
                </p>
                <button type="submit">Continue to my music</button>
              </form>

              {error && (
                <p id="error" className="error">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="connect-steps">
          <div className="connect-step">
            <div className="connect-step-number">1</div>
            <div className="connect-step-body">
              <div className="connect-step-title">Open LocalStream</div>
              <div className="connect-step-text">Start the LocalStream desktop/mobile app on your server machine.</div>
            </div>
          </div>
          <div className="connect-step">
            <div className="connect-step-number">2</div>
            <div className="connect-step-body">
              <div className="connect-step-title">Copy the Main Server URL</div>
              <div className="connect-step-text">In the app, copy the URL shown under &ldquo;Main server&rdquo;.</div>
            </div>
          </div>
          <div className="connect-step">
            <div className="connect-step-number">3</div>
            <div className="connect-step-body">
              <div className="connect-step-title">Paste and connect</div>
              <div className="connect-step-text">Paste it above and start exploring your library in the browser.</div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
