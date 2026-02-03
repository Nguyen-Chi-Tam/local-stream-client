import React, { useState } from 'react';
import { Youtube, Facebook, Instagram, Twitter, Github, Mail } from 'lucide-react';

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
    <main className="page page-connect">
      <section className="connect-card connect-shell">
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

        <div className="connect-extra">
          <div className="connect-download-row">
            <a
              href="https://play.google.com/store/apps/details?id=com.jeet_studio.localstream4k&hl=en"
              target="_blank"
              rel="noopener noreferrer"
              className="connect-android-link"
            >
              Download LocalStream for Android
            </a>
            <a
              href="https://github.com/manjeetdeswal/Local-Stream-Upnp---Http-Server-"
              target="_blank"
              rel="noopener noreferrer"
              className="connect-desktop-link"
            >
              Download LocalStream for Windows/Mac/Linux
            </a>
          </div>

          <div className="connect-guide-grid">
            <figure className="connect-guide-item">
              <img
                className="connect-guide-img-step1"
                src="/start-server-on-your-device.jpg"
                alt="Start the LocalStream server on your device"
              />
              <figcaption>1. Start the LocalStream server on your main device.</figcaption>
            </figure>
            <figure className="connect-guide-item">
              <div className="connect-guide-stack">
                <div>
                  <img src="/type-the-server-address.png" alt="Copy and type the server address" />
                  <p className="connect-guide-step-text">
                    2. Copy the Main Server URL and paste it into the box above.
                  </p>
                </div>
                <div>
                  <img src="/start-music-streaming.png" alt="Start streaming your music" />
                  <p className="connect-guide-step-text">3. Hit Continue and start streaming your music.</p>
                  <img
                    className="connect-guide-img-windows"
                    src="/localstream-pc.png"
                    alt="LocalStream Server running on Windows"
                  />
                  <p className="connect-guide-step-text">
                    LocalStream Server on Windows/Mac and Linux also works.
                  </p>
                  <p className="connect-guide-note">
                    To prevent your phone&apos;s custom ringtones from appearing here, set their album
                    name to one of: "Alarms", "Ringtone", or "Notifications".
                  </p>
                </div>
              </div>
            </figure>
          </div>
        </div>
      </section>

      <footer className="connect-credit">
        <p className="connect-credit-text">My social account:</p>
        <div className="connect-credit-links">
          <a
            href="https://www.youtube.com/@hoathuyetnhatnhat8919"
            target="_blank"
            rel="noopener noreferrer"
            className="connect-credit-icon youtube"
            aria-label="YouTube"
          >
            <Youtube />
          </a>
          <a
            href="https://www.facebook.com/nguyen.chi.tam.418729/"
            target="_blank"
            rel="noopener noreferrer"
            className="connect-credit-icon facebook"
            aria-label="Facebook"
          >
            <Facebook />
          </a>
          <a
            href="https://www.instagram.com/qsd8gen1/"
            target="_blank"
            rel="noopener noreferrer"
            className="connect-credit-icon instagram"
            aria-label="Instagram"
          >
            <Instagram />
          </a>
          <a
            href="https://x.com/scousersvn"
            target="_blank"
            rel="noopener noreferrer"
            className="connect-credit-icon twitter"
            aria-label="Twitter/X"
          >
            <Twitter />
          </a>
          <a
            href="https://github.com/Nguyen-Chi-Tam"
            target="_blank"
            rel="noopener noreferrer"
            className="connect-credit-icon github"
            aria-label="GitHub"
          >
            <Github />
          </a>
        </div>
        <div className="connect-credit-email">
          <Mail className="connect-credit-email-icon" />
          <a href="mailto:fegeltronics@gmail.com">fegeltronics@gmail.com</a>
        </div>
      </footer>
    </main>
  );
}
