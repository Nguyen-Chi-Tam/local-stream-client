import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Play, Pause, Rewind, FastForward, SkipBack, SkipForward, Delete } from 'lucide-react';
import { fetchMediaItemsCached, getMediaEndpoint } from '../functions/mediaApiCache.js';
import { NativeSelect, NativeSelectOption } from './ui/native-select.jsx';
import MediaItem from './MediaItem.jsx';
import PhotoItem from './PhotoItem.jsx';
import { showToast } from '../functions/queueService.js';
import {
  getItemId,
  getMediaType,
  pickTitle,
  pickArtist,
  pickDuration,
  pickDurationSeconds,
  pickThumbnailUrl,
  pickSourceUrl,
  filterItems,
  sortItems,
} from '../functions/mediaUtils.js';

const STORAGE_KEY = 'localstream_server_url';

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
  if (!raw) {
    const numericId = parseInt(item.id, 10);
    if (!Number.isNaN(numericId)) return numericId;
    return 0;
  }
  if (typeof raw === 'number') return raw;
  const fromDate = Date.parse(String(raw));
  if (Number.isNaN(fromDate)) return 0;
  return fromDate;
}

function normalizeDurationSeconds(raw, unit = 'seconds') {
  if (raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;

  if (unit === 'milliseconds') {
    return Math.round(n / 1000);
  }

  return Math.round(n);
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return hrs + ':' + (mins < 10 ? '0' + mins : mins) + ':' + (secs < 10 ? '0' + secs : secs);
  }
  return mins + ':' + (secs < 10 ? '0' + secs : secs);
}





export default function VisualMediaPage({
  serverUrl,
  onChangeServer,
  onNavigate,
  mediaType,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState('date');
  const [isSortReversed, setIsSortReversed] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [shouldAutoPlaySelectedVideo, setShouldAutoPlaySelectedVideo] = useState(false);

  const videoRef = useRef(null);
  const {
    isPlaying: isSelectedVideoPlaying,
    setIsPlaying: setIsSelectedVideoPlaying,
    currentTime: selectedVideoCurrentTime,
    setCurrentTime: setSelectedVideoCurrentTime,
    currentDuration: selectedVideoDuration,
    setCurrentDuration: setSelectedVideoDuration,
    bufferedTime: selectedVideoBufferedTime,
    setBufferedTime: setSelectedVideoBufferedTime,
    updateBufferedTime: updateSelectedVideoBufferedTime,
    togglePlayPause: toggleSelectedVideoPlayback,
    skipRelative: skipVideoRelative,
    seekTo,
  } = useMediaPlayer(videoRef);
  const searchInputRef = useRef(null);

  const playedRef = useRef(null);
  const rangeInputRef = useRef(null);
  const timeTextRef = useRef(null);
  const isScrubbingRef = useRef(false);

  useEffect(() => {
    let animId;
    const updateTimeline = () => {
      const video = videoRef.current;
      if (video && !video.paused && !video.seeking && !isScrubbingRef.current) {
        const t = video.currentTime || 0;
        const dur = selectedVideoDuration || 0;
        if (dur > 0) {
          const pct = Math.max(0, Math.min((t / dur) * 100, 100));
          if (playedRef.current) {
            playedRef.current.style.width = `${pct}%`;
          }
          if (rangeInputRef.current) {
            rangeInputRef.current.value = Math.min(t, dur);
          }
          if (timeTextRef.current) {
            timeTextRef.current.textContent = formatTime(t);
          }
        }
      }
      animId = requestAnimationFrame(updateTimeline);
    };

    if (isSelectedVideoPlaying) {
      animId = requestAnimationFrame(updateTimeline);
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isSelectedVideoPlaying, selectedVideoDuration, videoRef]);

  // Sync timeline DOM values when currentTime or duration updates from outside
  useEffect(() => {
    const range = rangeInputRef.current;
    const played = playedRef.current;
    const timeText = timeTextRef.current;
    
    if (range && !isScrubbingRef.current) {
      const dur = selectedVideoDuration || 0;
      range.value = Math.min(selectedVideoCurrentTime, dur);
      if (dur > 0) {
        const pct = Math.max(0, Math.min((selectedVideoCurrentTime / dur) * 100, 100));
        if (played) played.style.width = `${pct}%`;
      } else {
        if (played) played.style.width = '0%';
      }
      if (timeText) timeText.textContent = formatTime(selectedVideoCurrentTime);
    }
  }, [selectedVideoCurrentTime, selectedVideoDuration, formatTime]);

  function handleSelectedVideoSeekInstant(e) {
    const val = Number(e.target.value) || 0;
    const dur = selectedVideoDuration || 0;
    if (dur > 0) {
      const pct = Math.max(0, Math.min((val / dur) * 100, 100));
      if (playedRef.current) {
        playedRef.current.style.width = `${pct}%`;
      }
      if (timeTextRef.current) {
        timeTextRef.current.textContent = formatTime(val);
      }
    }
    seekTo(val);
    updateSelectedVideoBufferedTime();
  }

  const isVideoMode = mediaType === 'VIDEO';
  const pageTitle = isVideoMode ? 'My Videos' : 'My Photos';
  const emptyText = isVideoMode
    ? 'No videos found on this server.'
    : 'No photos found on this server.';

  useEffect(() => {
    if (!serverUrl) return;

    setLoading(true);
    setError('');

    const endpoint = getMediaEndpoint(serverUrl);

    let cancelled = false;

    fetchMediaItemsCached(serverUrl)
      .then((rawItems) => {
        if (cancelled) return;

        const nextItems = rawItems
          .map((item, index) => ({ ...item, __index: index }))
          .filter((item) => getMediaType(item) === mediaType);

        setItems(nextItems);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setError(
          'Could not load media from ' +
            endpoint +
            '. Make sure LocalStream is running and CORS is enabled.'
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [serverUrl, mediaType]);

  useEffect(() => {
    if (!serverUrl) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, serverUrl);
    } catch {
      // ignore
    }
  }, [serverUrl]);

  const filtered = useMemo(() => filterItems(items, searchQuery), [items, searchQuery]);
  const sorted = useMemo(
    () => sortItems(filtered, sortKey, isSortReversed),
    [filtered, sortKey, isSortReversed]
  );

  const selectedVideo = useMemo(() => {
    if (!isVideoMode || !items.length || selectedVideoId == null) return null;
    const found = items.find((item) => getItemId(item) === selectedVideoId);
    return found || null;
  }, [isVideoMode, items, selectedVideoId]);

  const selectedVideoSource = useMemo(
    () => (selectedVideo ? pickSourceUrl(serverUrl, selectedVideo, 'VIDEO') : ''),
    [serverUrl, selectedVideo]
  );

  const selectedVideoPoster = useMemo(
    () => (selectedVideo ? pickThumbnailUrl(serverUrl, selectedVideo, 'VIDEO') : ''),
    [serverUrl, selectedVideo]
  );

  useEffect(() => {
    if (!isVideoMode) {
      setSelectedVideoId(null);
      setShouldAutoPlaySelectedVideo(false);
      return;
    }

    if (!items.length) {
      setSelectedVideoId(null);
      setShouldAutoPlaySelectedVideo(false);
      return;
    }

    const exists =
      selectedVideoId != null &&
      items.some((item) => getItemId(item) === selectedVideoId);

    if (!exists) {
      setSelectedVideoId(null);
      setShouldAutoPlaySelectedVideo(false);
    }
  }, [isVideoMode, items, selectedVideoId]);

  useEffect(() => {
    if (!shouldAutoPlaySelectedVideo) return;
    const video = videoRef.current;
    if (!video) return;
    video
      .play()
      .catch(() => {
        // Browser autoplay may fail without gesture.
      });
    setShouldAutoPlaySelectedVideo(false);
  }, [shouldAutoPlaySelectedVideo, selectedVideoSource]);



  function handleSelectedVideoLoadedMetadata(event) {
    const duration = Number(event.currentTarget.duration) || 0;
    if (Number.isFinite(duration) && duration > 0) {
      setSelectedVideoDuration(duration);
    } else {
      setSelectedVideoDuration(0);
    }
    updateSelectedVideoBufferedTime();
  }

  function handleSelectedVideoTimeUpdate(event) {
    setSelectedVideoCurrentTime(event.currentTarget.currentTime || 0);
    updateSelectedVideoBufferedTime();
  }

  function handleSelectedVideoProgress() {
    updateSelectedVideoBufferedTime();
  }

  useEffect(() => {
    setIsSelectedVideoPlaying(false);
    setSelectedVideoCurrentTime(0);
    setSelectedVideoDuration(0);
    setSelectedVideoBufferedTime(0);
  }, [selectedVideoSource]);

  function handlePlayVideo(item) {
    const id = getItemId(item);
    setSelectedVideoId(id);
    setShouldAutoPlaySelectedVideo(true);
  }

  function goToPreviousVideo() {
    if (!sorted.length || selectedVideoId == null) return;
    const currentIdx = sorted.findIndex((item) => getItemId(item) === selectedVideoId);
    if (currentIdx <= 0) return;
    handlePlayVideo(sorted[currentIdx - 1]);
  }

  function goToNextVideo() {
    if (!sorted.length || selectedVideoId == null) return;
    const currentIdx = sorted.findIndex((item) => getItemId(item) === selectedVideoId);
    if (currentIdx < 0 || currentIdx >= sorted.length - 1) return;
    handlePlayVideo(sorted[currentIdx + 1]);
  }

  return (
    <>
      <header className="top-bar">
        <div className="top-bar-left">
          <h1>{pageTitle}</h1>
          {serverUrl && (
            <a
              id="server-label"
              className="server-label"
              href={serverUrl}
              target="_blank"
              rel="noreferrer"
            >
              {`Connected to ${serverUrl}`}
            </a>
          )}
        </div>
        <div className="top-bar-right">
          <div className="media-nav" role="tablist" aria-label="Media sections">
            <button
              type="button"
              className="secondary"
              onClick={() => onNavigate('/media')}
            >
              Music
            </button>
            <button
              type="button"
              className={isVideoMode ? 'secondary media-nav-active' : 'secondary'}
              onClick={() => onNavigate('/media/video')}
            >
              Video
            </button>
            <button
              type="button"
              className={!isVideoMode ? 'secondary media-nav-active' : 'secondary'}
              onClick={() => onNavigate('/media/photo')}
            >
              Photo
            </button>
          </div>
          <button
            id="change-server"
            className="secondary"
            type="button"
            onClick={onChangeServer}
          >
            Change Server
          </button>
        </div>
      </header>

      <main className="page">
        <section className="card full">
          {loading && <div className="info">Loading media from LocalStream...</div>}
          {error && !loading && <div className="error">{error}</div>}
          {!loading && !error && sorted.length === 0 && (
            <div className="info">{emptyText}</div>
          )}

          <div className="toolbar-row">
            <div className="search-row">
              <input
                type="search"
                placeholder={isVideoMode ? 'Search videos...' : 'Search photos...'}
                aria-label="Search media"
                value={searchQuery}
                ref={searchInputRef}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button
                type="button"
                className="search-clear-button"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                disabled={!searchQuery}
              >
                <Delete size={16} />
              </button>
            </div>
            <div className="sort-row">
              <label htmlFor="visual-sort-select" className="sort-label">
                Sort by
              </label>
              <NativeSelect
                id="visual-sort-select"
                aria-label="Sort media list"
                value={sortKey}
                onChange={(e) => {
                  const val = e.target.value || 'date';
                  setSortKey(val);
                  const labels = { date: 'Date', name: 'Name', duration: 'Duration' };
                  const label = labels[val] || (val ? val.charAt(0).toUpperCase() + val.slice(1) : 'Date');
                  showToast({ action: 'sort', message: `Sort by: ${label}` });
                }}
              >
                <NativeSelectOption value="date">Date</NativeSelectOption>
                <NativeSelectOption value="name">Name</NativeSelectOption>
                {isVideoMode && <NativeSelectOption value="duration">Duration</NativeSelectOption>}
              </NativeSelect>
              <button
                type="button"
                className="icon-button sort-icon-button"
                aria-label="Reverse current order"
                onClick={() => {
                  const next = !isSortReversed;
                  setIsSortReversed(next);
                  showToast({
                    action: 'sort_order',
                    isSortReversed: next,
                    message: `Sort order: ${next ? 'Descending' : 'Ascending'}`,
                  });
                }}
              >
                ⇅
              </button>
            </div>
          </div>

          {isVideoMode ? (
            <>
              <section className="video-top-player" hidden={!selectedVideo}>
                {selectedVideo && (
                  <>
                    <video
                      ref={videoRef}
                      key={selectedVideoSource}
                      controls={false}
                      preload="metadata"
                      poster={selectedVideoPoster || undefined}
                      playsInline
                      webkit-playsinline="true"
                      onLoadedMetadata={handleSelectedVideoLoadedMetadata}
                      onTimeUpdate={handleSelectedVideoTimeUpdate}
                      onProgress={handleSelectedVideoProgress}
                      onPlay={() => setIsSelectedVideoPlaying(true)}
                      onPause={() => setIsSelectedVideoPlaying(false)}
                    >
                      <source src={selectedVideoSource} />
                    </video>
                    <div className="video-top-meta">
                      <div className="video-top-title" title={pickTitle(selectedVideo)}>
                        {pickTitle(selectedVideo)}
                      </div>
                      <div className="video-seekbar-row" aria-label="Video timeline">
                        <span ref={timeTextRef} className="video-time-label">{formatTime(selectedVideoCurrentTime)}</span>
                        <div className={`player-seekbar-wrap${isSelectedVideoPlaying ? ' is-playing' : ''}`}>
                          <div className="seekbar-custom-track" />
                          <div
                            className="seekbar-custom-buffered"
                            style={{
                              width: `${Math.max(
                                0,
                                Math.min((selectedVideoBufferedTime / (selectedVideoDuration || 1)) * 100, 100)
                              )}%`,
                            }}
                          />
                          <div
                            ref={playedRef}
                            className="seekbar-custom-played"
                            style={{
                              width: `${Math.max(
                                0,
                                Math.min((selectedVideoCurrentTime / (selectedVideoDuration || 1)) * 100, 100)
                              )}%`,
                            }}
                          />
                          <input
                            ref={rangeInputRef}
                            type="range"
                            min="0"
                            max={Math.max(1, selectedVideoDuration || 0)}
                            step="any"
                            onChange={handleSelectedVideoSeekInstant}
                            onInput={handleSelectedVideoSeekInstant}
                            onPointerDown={() => { isScrubbingRef.current = true; }}
                            onPointerUp={() => { isScrubbingRef.current = false; }}
                            onPointerCancel={() => { isScrubbingRef.current = false; }}
                          />
                        </div>
                        <span className="video-time-label">{formatTime(selectedVideoDuration)}</span>
                      </div>
                      <div className="video-controls" aria-label="Video playback controls">
                        <button
                          type="button"
                          className="icon-button play-main"
                          aria-label={isSelectedVideoPlaying ? 'Pause video' : 'Play video'}
                          onClick={toggleSelectedVideoPlayback}
                        >
                          {isSelectedVideoPlaying ? (
                            <Pause size={18} fill="currentColor" stroke="none" />
                          ) : (
                            <Play size={18} fill="currentColor" stroke="none" />
                          )}
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Previous video"
                          onClick={goToPreviousVideo}
                        >
                          <SkipBack size={18} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Rewind 10 seconds"
                          onClick={() => skipVideoRelative(-10)}
                        >
                          <Rewind size={18} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Fast forward 10 seconds"
                          onClick={() => skipVideoRelative(10)}
                        >
                          <FastForward size={18} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Next video"
                          onClick={goToNextVideo}
                        >
                          <SkipForward size={18} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </section>

              <ul className="music-list" aria-label="Video list">
                {sorted.map((item) => {
                  const key = String(getItemId(item) ?? item.__index ?? pickTitle(item));
                  const isActive =
                    !!selectedVideo && getItemId(selectedVideo) === getItemId(item);

                  return (
                    <MediaItem
                      key={key}
                      item={item}
                      isActive={isActive}
                      serverUrl={serverUrl}
                      onSelect={handlePlayVideo}
                      subtitle="Video"
                    />
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="visual-grid" aria-label="Photo gallery">
              {sorted.map((item) => {
                const key = String(getItemId(item) ?? item.__index ?? pickTitle(item));
                const sourceUrl = pickSourceUrl(serverUrl, item, mediaType);
                const thumbUrl = pickThumbnailUrl(serverUrl, item, mediaType);

                return (
                  <PhotoItem
                    key={key}
                    item={item}
                    serverUrl={serverUrl}
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        window.open(sourceUrl || thumbUrl, '_blank');
                      }
                    }}
                  />
                );
              })}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
