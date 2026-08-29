
import React, { useRef, useState } from 'react';
import { createLucideIcon, Mail, X, Play, Pause, SkipBack, SkipForward, Rewind, FastForward, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';

// Brand icons removed in lucide-react 1.0+ - provided here as local SVGs
const Youtube = createLucideIcon('Youtube', [
  [
    'rect',
    {
      width: '18',
      height: '12',
      x: '3',
      y: '6',
      rx: '3',
      key: 'video',
    },
  ],
  [
    'path',
    {
      d: 'm10 9.5 5 2.5-5 2.5z',
      key: 'play',
    },
  ],
]);

const Facebook = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-facebook">
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
);

const Instagram = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-instagram">
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);

const Twitter = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-twitter">
    <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
  </svg>
);

const Github = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-github">
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);


import startServerImg from '../../public/start-server-on-your-device.jpg';
import typeServerImg from '../../public/type-the-server-address.png';
import startMusicImg from '../../public/start-music-streaming.png';
import musicStreamingImg from '../../public/music-streaming.png';
import streamingVideosImg from '../../public/streaming-your-videos.png';
import viewingPhotosImg from '../../public/viewing_photos.png';
import logoImg from '../../public/localstream.png';




const STORAGE_KEY = 'localstream_server_url';
const RECENT_SERVERS_KEY = 'localstream_recent_servers';

const isElectron = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);


function normalizeUrl(raw) {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return 'http://' + trimmed;
  }
  return trimmed.replace(/\/$/, '');
}

export default function ConnectPage({ onConnected }) {
  const inputRef = useRef(null);
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) return stored;
      const recents = window.localStorage.getItem(RECENT_SERVERS_KEY);
      if (recents) {
        const parsed = JSON.parse(recents);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed[0];
        }
      }
      return '';
    } catch {
      return '';
    }
  });
  const [recentServers, setRecentServers] = useState(() => {
    try {
      const stored = window.localStorage.getItem(RECENT_SERVERS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [error, setError] = useState('');

  const hasDigits = /\d/.test(value);

  const getNumberRanges = (text) => {
    const ranges = [];
    let start = -1;

    for (let i = 0; i < text.length; i += 1) {
      const isDigit = text[i] >= '0' && text[i] <= '9';

      if (isDigit && start === -1) {
        start = i;
      } else if (!isDigit && start !== -1) {
        ranges.push([start, i - 1]);
        start = -1;
      }
    }

    if (start !== -1) {
      ranges.push([start, text.length - 1]);
    }

    return ranges;
  };

  const getNavStates = (text) => {
    const ranges = getNumberRanges(text);
    return ranges.map(([start, end]) => ({
      start,
      end: end + 1,
    }));
  };

  const moveToNumberPart = (direction) => {
    const input = inputRef.current;
    if (!input) return;

    const text = input.value || '';
    const states = getNavStates(text);
    if (!states.length) return;

    const cStart = typeof input.selectionStart === 'number' ? input.selectionStart : 0;
    const cEnd = typeof input.selectionEnd === 'number' ? input.selectionEnd : cStart;

    const isCollapsed = cStart === cEnd;
    const currentIndex = isCollapsed
      ? states.findIndex((s) => cStart >= s.start && cStart <= s.end)
      : states.findIndex((s) => cStart < s.end && cEnd > s.start);

    let targetIndex = -1;

    if (currentIndex !== -1) {
      targetIndex = direction === 'prev'
        ? (currentIndex - 1 + states.length) % states.length
        : (currentIndex + 1) % states.length;
    } else {
      if (direction === 'prev') {
        let prevIndex = -1;
        for (let i = states.length - 1; i >= 0; i -= 1) {
          if (states[i].end <= cStart) {
            prevIndex = i;
            break;
          }
        }
        targetIndex = prevIndex !== -1 ? prevIndex : states.length - 1;
      } else {
        const nextIndex = states.findIndex((s) => s.start >= cEnd);
        targetIndex = nextIndex !== -1 ? nextIndex : 0;
      }
    }

    const targetState = states[targetIndex];
    input.focus();
    input.setSelectionRange(targetState.start, targetState.end);
  };

  const removeServer = (urlToRemove, e) => {
    e.stopPropagation();
    const updated = recentServers.filter(u => u !== urlToRemove);
    setRecentServers(updated);
    try {
      window.localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify(updated));
    } catch (err) {
      // ignore
    }
  };



  function handleSubmit(event) {
    event.preventDefault();
    setError('');

    const url = normalizeUrl(value);

    // Enforce strict http://<ip_address>:<port_number> or http://localhost:<port_number> format
    const ipPortRegex = /^http:\/\/(?:(?:\d{1,3}\.){3}\d{1,3}|localhost):\d{1,5}$/;
    if (!ipPortRegex.test(url)) {
      setError('Invalid format. Please use the format: http://<ip_address>:<port_number> (e.g. http://192.168.1.4:8080)');
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, url);

      const updatedRecent = [url, ...recentServers.filter(s => s !== url)].slice(0, 5);

      window.localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify(updatedRecent));
      setRecentServers(updatedRecent);
    } catch {
      // ignore storage failures
    }


    onConnected(url);
  }

  return (
    <main className="page page-connect">
      <section className="connect-card connect-shell">
        <div className="connect-layout">

          <div className="connect-left">
            <div className="connect-pill">LocalStream Client</div>
            <div className="connect-header">
              <img src={logoImg} alt="LocalStream Logo" className="connect-logo" />
              <h1>Connect and stream your personal music library.</h1>
            </div>

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
                Paste the <strong>Main Server URL</strong> from the LocalStream app.
              </p>

              <form id="server-form" className="form" onSubmit={handleSubmit}>
                <div className="label-row">
                  <label htmlFor="server-url">LocalStream server address</label>
                  <div className="label-actions">
                    <button
                      type="button"
                      className="label-nav-button"
                      onClick={() => moveToNumberPart('prev')}
                      aria-label="Select previous number"
                      title="Select previous number"
                      disabled={!hasDigits}
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      type="button"
                      className="label-nav-button"
                      onClick={() => moveToNumberPart('next')}
                      aria-label="Select next number"
                      title="Select next number"
                      disabled={!hasDigits}
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
                <div className="server-input-row">
                  <input
                    id="server-url"
                    name="server-url"
                    type="url"
                    placeholder="e.g. http://192.168.1.11:8080"
                    required
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    ref={inputRef}
                  />
                  <button
                    type="button"
                    className="server-clear-button"
                    onClick={() => {
                      setValue('');
                      setError('');
                      if (inputRef.current) {
                        inputRef.current.focus();
                      }
                    }}
                    disabled={!value}
                    aria-label="Clear server address"
                    title="Clear server address"
                  >
                    <X size={16} />
                  </button>
                </div>
                <p className="hint">
                  This value never leaves your device — it&apos;s stored in your browser only.
                </p>
                <button type="submit" className="connect-submit-button">Continue</button>
              </form>

              {error && (
                <div id="error" className="error">
                  <span>{error}</span>
                  <button
                    type="button"
                    className="alert-dismiss"
                    onClick={() => setError('')}
                    aria-label="Dismiss error"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {recentServers.length > 0 && (
          <div className="quick-connect">
            <span className="quick-connect-label">Quick Connect:</span>
            <div className="quick-connect-list">
              {recentServers.map((url) => (
                <div key={url} className="quick-connect-item-wrapper">
                  <button
                    type="button"
                    className="quick-connect-item"
                    onClick={() => setValue(url)}
                  >
                    {url.replace(/^https?:\/\//i, '')}
                  </button>
                  <button
                    type="button"
                    className="quick-connect-remove"
                    onClick={(e) => removeServer(url, e)}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}

            </div>
          </div>
        )}



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
          {!isElectron && (
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
                href="https://github.com/Nguyen-Chi-Tam/local-stream-client/releases/download/download/Local.Stream.Client.Setup.2.0.9.exe"
                target="_blank"
                rel="noopener noreferrer"
                className="connect-desktop-link"
              >
                Download LocalStream Client for Windows
              </a>
              <a
                href="https://github.com/Nguyen-Chi-Tam/local-stream-client"
                target="_blank"
                rel="noopener noreferrer"
                className="repo-link"
              >
                LocalStream Client GitHub Repository
              </a>

            </div>
          )}

          <div className="connect-guide-grid">
            <figure className="connect-guide-item">
              <img
                className="connect-guide-img-step1"
                src={startServerImg}
                alt="Start the LocalStream server on your device"
              />
              <figcaption>1. Start the LocalStream server on your main device.</figcaption>
            </figure>
            <figure className="connect-guide-item">
              <div className="connect-guide-stack">
                <div>
                  <img src={typeServerImg} alt="Copy and type the server address" />
                  <p className="connect-guide-step-text">
                    2. Copy the Main Server URL and paste it into the box above.
                  </p>
                </div>
                <div>
                  <img src={startMusicImg} alt="Start streaming your music" />
                  <p className="connect-guide-step-text">3. Hit Continue and start streaming.</p>
                </div>
                <div className="connect-keyboard-guide">
                  <div className="connect-keyboard-title">Keyboard Shortcuts</div>
                  <div className="keyboard-container">
                    <div className="keyboard-row">
                      <div className="keycap" title="Previous track">
                        <span className="key-char">C</span>
                        <span className="key-icon-wrapper"><SkipBack size={13} /></span>
                        <span className="key-label">Prev</span>
                      </div>
                      <div className="keycap" title="Rewind 10 seconds">
                        <span className="key-char">V</span>
                        <span className="key-icon-wrapper"><Rewind size={13} /></span>
                        <span className="key-label">Rew 10s</span>
                      </div>
                      <div className="keycap" title="Restart current song">
                        <span className="key-char">B</span>
                        <span className="key-icon-wrapper"><RotateCcw size={13} /></span>
                        <span className="key-label">Restart</span>
                      </div>
                      <div className="keycap" title="Fast forward 10 seconds">
                        <span className="key-char">N</span>
                        <span className="key-icon-wrapper"><FastForward size={13} /></span>
                        <span className="key-label">Fwd 10s</span>
                      </div>
                      <div className="keycap" title="Next track">
                        <span className="key-char">M</span>
                        <span className="key-icon-wrapper"><SkipForward size={13} /></span>
                        <span className="key-label">Next</span>
                      </div>
                    </div>
                    <div className="keyboard-row">
                      <div className="keycap spacebar" title="Play / Pause">
                        <span className="key-char">Space</span>
                        <span className="key-icon-wrapper spacebar-icons">
                          <Play size={12} fill="currentColor" />
                          <Pause size={12} fill="currentColor" />
                        </span>
                        <span className="key-label">Play / Pause</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </figure>
          </div>
        </div>
        <div className="connect-showcase">
          <div className="showcase-item music-section hero">

            <div className="showcase-content">
              <div className="showcase-badge music">Pure Audio Bliss</div>
              <h3>Stream Your Music Library In High Fidelity.</h3>
              <p>
                Browse your entire music collection with an elegant, lightning-fast interface.
                Experience gapless playback, high-quality audio streaming, and intelligent
                sorting by artist, album, or folder.
              </p>
              <ul className="showcase-features">
                <li>High-fidelity audio streaming</li>
                <li>Gapless playback & intuitive player</li>
                <li>Advanced search & library management</li>
              </ul>
            </div>
            <div className="showcase-image-wrapper hero-wrapper">
              <img src={musicStreamingImg} alt="Music Streaming" />
            </div>
          </div>

          <div className="showcase-item video-section">

            <div className="showcase-content">
              <div className="showcase-badge">Video Streaming</div>
              <h3>Your Entire Video Library, Anywhere.</h3>
              <p>
                From family movies to your favorite series, stream high-definition video directly
                to your browser. Experience smooth playback with intuitive controls and
                automatic library organization.
              </p>
              <ul className="showcase-features">
                <li>Instant playback without buffering</li>
                <li>Intuitive seek and volume controls</li>
                <li>Beautifully organized library view</li>
              </ul>
            </div>
            <div className="showcase-image-wrapper">
              <img src={streamingVideosImg} alt="Streaming Videos" />
            </div>
          </div>

          <div className="showcase-item photo-section">
            <div className="showcase-content">

              <div className="showcase-badge photo">Photo Gallery</div>
              <h3>Relive Your Favorite Memories.</h3>
              <p>
                Browse through your personal photo collection with a stunning, responsive
                gallery. Features high-resolution viewing, smooth transitions, and
                intelligent folder-based organization.
              </p>
              <ul className="showcase-features">
                <li>High-resolution photo viewing</li>
                <li>Smooth, responsive gallery grid</li>
                <li>Easy folder-based navigation</li>
              </ul>
            </div>
            <div className="showcase-image-wrapper">
              <img src={viewingPhotosImg} alt="Viewing Photos" />
            </div>
          </div>
        </div>
      </section>

      <footer className="connect-credit">
        <p className="connect-credit-text" style={{ marginBottom: '0.75rem' }}>
          @2026 <a href="https://manjeetdeswal.github.io/Local-Stream-Upnp---Http-Server-/" target="_blank" rel="noopener noreferrer" className="connect-credit-link">LocalStream</a> is an app made by <a href="https://github.com/manjeetdeswal" target="_blank" rel="noopener noreferrer" className="connect-credit-link">Manjeet Deswal</a>
        </p>
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
