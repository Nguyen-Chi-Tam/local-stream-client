(function () {
  const STORAGE_KEY = 'localstream_server_url';

  const serverLabel = document.getElementById('server-label');
  const changeServerButton = document.getElementById('change-server');
  const searchInput = document.getElementById('search-input');
  const clearSearchButton = document.getElementById('clear-search');
  const sortSelect = document.getElementById('sort-select');
  const sortReverseButton = document.getElementById('sort-reverse');
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const emptyEl = document.getElementById('empty');
  const listEl = document.getElementById('music-list');
  const playerEl = document.getElementById('player');
  const audioEl = document.getElementById('audio');
  const currentTitleEl = document.getElementById('current-title');
  const currentArtistEl = document.getElementById('current-artist');

  const prevTrackButton = document.getElementById('prev-track');
  const nextTrackButton = document.getElementById('next-track');
  const shuffleToggleButton = document.getElementById('shuffle-toggle');
  const repeatToggleButton = document.getElementById('repeat-toggle');

  let allMusicItems = [];
  let serverUrlCache = '';
  let playlistItems = [];
  let currentIndex = -1;
  let currentItemId = null;
  let isShuffle = false;
  let isRepeat = false;
  let sortKey = 'original';
  let isSortReversed = false;

  function getServerUrl() {
    return window.localStorage.getItem(STORAGE_KEY) || '';
  }

  function showError(message) {
    if (loadingEl) loadingEl.hidden = true;
    if (emptyEl) emptyEl.hidden = true;
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
  }

  function clearError() {
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
  }

  function setServerLabel(url) {
    if (!serverLabel) return;
    if (!url) {
      serverLabel.textContent = '';
      return;
    }
    serverLabel.textContent = 'Connected to ' + url;
  }

  function pickTitle(item) {
    if (!item) return 'Unknown title';
    const raw =
      item.title ||
      item.name ||
      item.fileName ||
      item.filename ||
      '';

    const text = String(raw).trim();
    return text || 'Unknown title';
  }

  function pickArtist(item) {
    return (
      item.artist ||
      item.albumArtist ||
      item.album ||
      ''
    );
  }

  function pickDuration(item) {
    const seconds = item.duration || item.lengthSeconds || item.seconds;
    if (!seconds && seconds !== 0) return '';
    const s = Math.round(seconds);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return mins + ':' + (secs < 10 ? '0' + secs : secs);
  }

  function pickDurationSeconds(item) {
    const seconds = item.duration || item.lengthSeconds || item.seconds;
    if (!seconds && seconds !== 0) return 0;
    return Number(seconds) || 0;
  }

  function getItemId(item) {
    if (!item) return null;
    const id = item.id ?? item.mediaId ?? item.audioId;
    return id != null ? id : null;
  }

  function filterItems(query) {
    if (!query) return allMusicItems;

    const q = String(query).trim().toLowerCase();
    if (!q) return allMusicItems;

    return allMusicItems.filter((item) => {
      const fields = [
        pickTitle(item),
        pickArtist(item),
        pickFolderName(item),
        item && (item.fileName || item.filename || item.name || ''),
      ];
      const haystack = fields
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  function isWavFile(item) {
    const candidates = [
      item && item.fileName,
      item && item.filename,
      item && item.name,
      item && item.title,
      item && item.path,
      item && item.filePath,
      item && item.location,
      item && item.url,
    ];

    return candidates.some((value) => {
      if (!value || typeof value !== 'string') return false;
      return /\.wav$/i.test(value.trim());
    });
  }

  function pickFolderName(item) {
    // Try explicit folder-like fields first.
    const direct =
      item.folder ||
      item.folderName ||
      item.container ||
      item.parent ||
      item.parentTitle ||
      '';
    if (direct) return String(direct);

    // Fall back to deriving from a path.
    const path =
      item.path ||
      item.filePath ||
      item.filepath ||
      item.fullPath ||
      item.location ||
      '';

    if (path) {
      const parts = String(path).split(/[\\/]+/).filter(Boolean);
      if (parts.length > 1) {
        // Use the parent folder name.
        return parts[parts.length - 2];
      }
    }

    // No folder info available; treat as unknown.
    return 'Unknown folder';
  }

  function pickDateValue(item) {
    if (!item) return 0;
    const raw =
      item.date ||
      item.added ||
      item.addedAt ||
      item.createdAt ||
      item.modifiedAt ||
      item.lastModified ||
      item.mtime ||
      item.timestamp ||
      '';
    if (!raw) return 0;

    if (typeof raw === 'number') return raw;
    const fromDate = Date.parse(String(raw));
    if (Number.isNaN(fromDate)) return 0;
    return fromDate;
  }

  function pickStreamUrl(serverUrl, item) {
    // LocalStream audio streaming pattern:
    //   http://<Stream URL>/media/audio/<Audio ID>
    // Try a few common ID field names from the API.
    const id = getItemId(item);
    if (!id && id !== 0) return '';

    const base = serverUrl.replace(/\/$/, '');
    return base + '/media/audio/' + encodeURIComponent(id);
  }

  function pickThumbnailUrl(serverUrl, item) {
    if (!item) return '';

    // If this specific album art path is present, treat it as
    // having no useful artwork so callers can fall back.
    if (item.albumArt === '/thumbnail/album/3579481289389474209') {
      return '';
    }

    const raw = item.thumbnail || item.albumArt || '';
    if (!raw) return '';

    const str = String(raw).trim();
    if (!str) return '';

    if (/^https?:\/\//i.test(str)) {
      return str;
    }

    const base = serverUrl.replace(/\/$/, '');
    if (str.startsWith('/')) {
      return base + str;
    }
    return base + '/' + str;
  }

  function sortItems(items) {
    if (!items || !items.length) return [];
    const arr = items.slice();

    arr.sort((a, b) => {
      if (sortKey === 'name') {
        const an = pickTitle(a).toLowerCase();
        const bn = pickTitle(b).toLowerCase();
        if (an < bn) return -1;
        if (an > bn) return 1;
        return 0;
      }
      if (sortKey === 'date') {
        const ad = pickDateValue(a);
        const bd = pickDateValue(b);
        return ad - bd;
      }
      if (sortKey === 'duration') {
        const ad = pickDurationSeconds(a);
        const bd = pickDurationSeconds(b);
        return ad - bd;
      }
      // 'original' or unknown: respect original index order if present.
      const ai = typeof a.__index === 'number' ? a.__index : 0;
      const bi = typeof b.__index === 'number' ? b.__index : 0;
      return ai - bi;
    });

    if (isSortReversed) arr.reverse();
    return arr;
  }

  function playItemByIndex(index) {
    if (!audioEl || !playlistItems || !playlistItems.length) return;
    if (index < 0 || index >= playlistItems.length) return;

    const item = playlistItems[index];
    const streamUrl = pickStreamUrl(serverUrlCache, item);
    if (!streamUrl) {
      showError('This item does not have a playable URL.');
      return;
    }

    clearError();
    audioEl.src = streamUrl;
    audioEl.play().catch((err) => {
      console.error(err);
      showError('Unable to start playback in this browser.');
    });

    if (currentTitleEl) currentTitleEl.textContent = pickTitle(item);
    if (currentArtistEl) currentArtistEl.textContent = pickArtist(item);
    if (playerEl) playerEl.hidden = false;

    currentIndex = index;
    currentItemId = getItemId(item);
  }

  function getNextIndex() {
    if (!playlistItems.length) return -1;
    if (isShuffle && playlistItems.length > 1) {
      let next = currentIndex;
      // Try a few times to get a different index.
      for (let i = 0; i < 5 && next === currentIndex; i += 1) {
        next = Math.floor(Math.random() * playlistItems.length);
      }
      return next;
    }
    if (currentIndex < 0) return 0;
    return (currentIndex + 1) % playlistItems.length;
  }

  function getPrevIndex() {
    if (!playlistItems.length) return -1;
    if (isShuffle && playlistItems.length > 1) {
      let prev = currentIndex;
      for (let i = 0; i < 5 && prev === currentIndex; i += 1) {
        prev = Math.floor(Math.random() * playlistItems.length);
      }
      return prev;
    }
    if (currentIndex < 0) return playlistItems.length - 1;
    return (currentIndex - 1 + playlistItems.length) % playlistItems.length;
  }

  function renderList(serverUrl, items) {
    if (!listEl) return;
    listEl.innerHTML = '';

    const sortedItems = sortItems(items || []);

    if (!sortedItems.length) {
      if (loadingEl) loadingEl.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    if (loadingEl) loadingEl.hidden = true;
    if (emptyEl) emptyEl.hidden = true;

    // Group items by folder name (similar to UPnP containers).
    const groups = {};
    sortedItems.forEach((item) => {
      const folder = pickFolderName(item) || 'Other';
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(item);
    });

    const folderNames = Object.keys(groups).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    const newPlaylist = [];

    folderNames.forEach((folder) => {
      const header = document.createElement('li');
      header.className = 'folder-header';
      header.textContent = folder;
      listEl.appendChild(header);

      groups[folder].forEach((item) => {
        const playlistIndex = newPlaylist.length;
        newPlaylist.push(item);

        const li = document.createElement('li');
        li.className = 'music-item';

        const artWrapper = document.createElement('div');
        artWrapper.className = 'music-art';
        const artUrl = pickThumbnailUrl(serverUrl, item);
        if (artUrl) {
          const img = document.createElement('img');
          img.src = artUrl;
          img.alt = pickTitle(item);
          artWrapper.appendChild(img);
        }

        const main = document.createElement('div');
        main.className = 'music-main';

        const titleEl = document.createElement('div');
        titleEl.className = 'music-title';
        titleEl.textContent = pickTitle(item);

        const artistEl = document.createElement('div');
        artistEl.className = 'music-artist';
        artistEl.textContent = pickArtist(item);

        const metaEl = document.createElement('div');
        metaEl.className = 'music-meta';
        metaEl.textContent = pickDuration(item);

        main.appendChild(titleEl);
        if (artistEl.textContent) main.appendChild(artistEl);
        if (metaEl.textContent) main.appendChild(metaEl);

        const actions = document.createElement('div');
        actions.className = 'music-actions';

        const playBtn = document.createElement('button');
        playBtn.textContent = 'Play';
        playBtn.addEventListener('click', () => {
          serverUrlCache = serverUrl;
          playItemByIndex(playlistIndex);
        });

        actions.appendChild(playBtn);

        li.appendChild(artWrapper);
        li.appendChild(main);
        li.appendChild(actions);
        listEl.appendChild(li);
      });
    });

    playlistItems = newPlaylist;

    if (currentItemId != null && playlistItems.length) {
      const idx = playlistItems.findIndex((item) => getItemId(item) === currentItemId);
      currentIndex = idx;
      if (idx === -1) {
        currentItemId = null;
      }
    }
  }

  async function loadMusic() {
    const serverUrl = getServerUrl();

    if (!serverUrl) {
      window.location.href = 'index.html';
      return;
    }

    serverUrlCache = serverUrl;
    setServerLabel(serverUrl);
    clearError();
    if (loadingEl) loadingEl.hidden = false;

    const base = serverUrl.replace(/\/$/, '');
    const endpoint = base + '/api/media';

    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Server responded with ' + response.status);
      }

      const data = await response.json();

      // Expect either an array or an object with `items` / `files` / `tracks`.
      const rawItems = Array.isArray(data)
        ? data
        : data.items || data.files || data.tracks || data.audio || [];

      // Only keep audio files: type === 'AUDIO' (case-insensitive) or
      // a similar field such as mediaType. Exclude .wav files.
      const items = rawItems.map((item, index) => ({ ...item, __index: index })).filter((item) => {
        const t =
          (item && (item.type || item.mediaType || item.kind || '')) || '';
        const isAudio = String(t).toUpperCase() === 'AUDIO';
        if (!isAudio) return false;
        const albumNameRaw =
          item &&
          (item.album ||
            item.albumTitle ||
            item.album_name ||
            item.albumName ||
            '');
        const albumName = String(albumNameRaw).trim().toLowerCase();
        if (albumName) {
          const blockedAlbums = ['alams', 'alarms', 'ringtones', 'notifications'];
          if (blockedAlbums.includes(albumName)) {
            return false;
          }
        }
        return !isWavFile(item);
      });

      allMusicItems = items;
      const query = searchInput ? searchInput.value : '';
      const displayItems = filterItems(query);
      renderList(serverUrl, displayItems);
    } catch (err) {
      console.error(err);
      showError(
        'Could not load music from ' +
          endpoint +
          '. Make sure LocalStream is running and CORS is enabled.'
      );
    }
  }

  if (changeServerButton) {
    changeServerButton.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const filtered = filterItems(searchInput.value);
      renderList(serverUrlCache, filtered);
    });
  }

  if (clearSearchButton && searchInput) {
    clearSearchButton.addEventListener('click', () => {
      if (!searchInput.value) return;
      searchInput.value = '';
      const filtered = filterItems('');
      renderList(serverUrlCache, filtered);
      searchInput.focus();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      sortKey = sortSelect.value || 'original';
      const query = searchInput ? searchInput.value : '';
      const filtered = filterItems(query);
      renderList(serverUrlCache, filtered);
    });
  }

  if (sortReverseButton) {
    sortReverseButton.addEventListener('click', () => {
      isSortReversed = !isSortReversed;
      const query = searchInput ? searchInput.value : '';
      const filtered = filterItems(query);
      renderList(serverUrlCache, filtered);
    });
  }

  if (prevTrackButton) {
    prevTrackButton.addEventListener('click', () => {
      const idx = getPrevIndex();
      if (idx >= 0) playItemByIndex(idx);
    });
  }

  if (nextTrackButton) {
    nextTrackButton.addEventListener('click', () => {
      const idx = getNextIndex();
      if (idx >= 0) playItemByIndex(idx);
    });
  }

  if (shuffleToggleButton) {
    shuffleToggleButton.addEventListener('click', () => {
      isShuffle = !isShuffle;
      shuffleToggleButton.classList.toggle('toggle-active', isShuffle);
      shuffleToggleButton.setAttribute('aria-pressed', String(isShuffle));
    });
  }

  if (repeatToggleButton) {
    repeatToggleButton.addEventListener('click', () => {
      isRepeat = !isRepeat;
      repeatToggleButton.classList.toggle('toggle-active', isRepeat);
      repeatToggleButton.setAttribute('aria-pressed', String(isRepeat));
      if (audioEl) {
        // When repeat is ON, loop the current track; when OFF, play through playlist.
        audioEl.loop = isRepeat;
      }
    });
  }

  if (audioEl) {
    audioEl.addEventListener('ended', () => {
      // When repeat is ON we rely on audioEl.loop to replay the same track.
      if (isRepeat) return;

      // When repeat is OFF, advance through the playlist (wrapping).
      const idx = getNextIndex();
      if (idx >= 0) playItemByIndex(idx);
    });
  }

  document.addEventListener('DOMContentLoaded', loadMusic);
})();
