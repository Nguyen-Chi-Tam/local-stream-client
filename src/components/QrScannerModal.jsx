import React, { useEffect, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import { QrCode, X, SwitchCamera, Zap, ZapOff, Upload, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

function playScanSuccessBeep() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {}
}

function stopHardwareCamera(videoEl, scanner) {
  // 1. Destroy the scanner instance
  if (scanner) {
    try {
      scanner.stop();
      scanner.destroy();
    } catch {}
  }

  // 2. Explicitly stop every hardware media track to turn off device LED light immediately
  if (videoEl && videoEl.srcObject instanceof MediaStream) {
    try {
      videoEl.srcObject.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
    } catch {}
    videoEl.srcObject = null;
  }
}

export default function QrScannerModal({ isOpen, onClose, onScan }) {
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const scannerRef = useRef(null);
  const hasDetectedRef = useRef(false);
  const currentCameraIndexRef = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [cameras, setCameras] = useState([]);
  const [hasFlash, setHasFlash] = useState(false);
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [scannedResultText, setScannedResultText] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const handleDetected = (rawText) => {
    if (hasDetectedRef.current) return;
    hasDetectedRef.current = true;

    // Turn off camera hardware immediately upon detection
    stopHardwareCamera(videoRef.current, scannerRef.current);
    scannerRef.current = null;

    playScanSuccessBeep();
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(100);
      } catch {}
    }

    setScanSuccess(true);
    setScannedResultText(rawText);

    setTimeout(() => {
      onScanRef.current?.(rawText);
    }, 450);
  };

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    hasDetectedRef.current = false;
    currentCameraIndexRef.current = 0;
    setIsLoading(true);
    setErrorMessage('');
    setScanSuccess(false);
    setScannedResultText('');

    const videoEl = videoRef.current;
    if (!videoEl) return;

    let scanner = null;

    async function initScanner() {
      try {
        scanner = new QrScanner(
          videoEl,
          (result) => {
            const text = typeof result === 'object' && result?.data ? result.data : String(result);
            handleDetected(text);
          },
          {
            preferredCamera: 'environment',
            highlightScanRegion: false,
            highlightCodeOutline: true,
            maxScansPerSecond: 10,
            returnDetailedScanResult: true,
            onDecodeError: () => {},
          }
        );

        scannerRef.current = scanner;
        await scanner.start();

        if (isMounted) {
          setIsLoading(false);

          // List cameras AFTER starting scanner (pass false to avoid creating conflicting streams)
          const availableCameras = await QrScanner.listCameras(false).catch(() => []);
          if (isMounted && availableCameras.length > 0) {
            setCameras(availableCameras);
          }

          const flashAvailable = await scanner.hasFlash().catch(() => false);
          if (isMounted) {
            setHasFlash(flashAvailable);
          }
        } else {
          stopHardwareCamera(videoEl, scanner);
        }
      } catch (err) {
        if (!isMounted) return;

        // Ignore abort errors caused by intentional teardowns
        const msg = String(err?.message || err || '');
        if (err?.name === 'AbortError' || msg.includes('interrupted by a new load request')) {
          return;
        }

        setIsLoading(false);
        if (err?.name === 'NotAllowedError' || msg.includes('Permission denied')) {
          setErrorMessage('Camera access was denied. Please allow camera permissions in your browser or upload a QR image.');
        } else if (err?.name === 'NotFoundError' || msg.includes('no camera') || msg.includes('DevicesNotFoundError')) {
          setErrorMessage('No camera device detected on this system. You can upload an image of the QR code below.');
        } else {
          setErrorMessage(`Unable to access camera: ${msg || 'Unknown error'}. You can upload an image instead.`);
        }
      }
    }

    initScanner();

    return () => {
      isMounted = false;
      stopHardwareCamera(videoEl, scannerRef.current || scanner);
      scannerRef.current = null;
    };
  }, [isOpen]); // Only runs when modal opens/closes - stable, never restarts while open!

  const handleSwitchCamera = async () => {
    if (cameras.length <= 1 || !scannerRef.current) return;
    const nextIndex = (currentCameraIndexRef.current + 1) % cameras.length;
    currentCameraIndexRef.current = nextIndex;
    const nextCamera = cameras[nextIndex];
    try {
      await scannerRef.current.setCamera(nextCamera.id);
      const flashAvailable = await scannerRef.current.hasFlash().catch(() => false);
      setHasFlash(flashAvailable);
      setIsFlashOn(false);
    } catch {}
  };

  const handleToggleFlash = async () => {
    if (!scannerRef.current || !hasFlash) return;
    try {
      await scannerRef.current.toggleFlash();
      setIsFlashOn(scannerRef.current.isFlashOn());
    } catch {}
  };

  const handleScanImageFile = async (file) => {
    if (!file) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const result = await QrScanner.scanImage(file, {
        returnDetailedScanResult: true,
        alsoTryWithoutScanRegion: true,
      });
      const text = typeof result === 'object' && result?.data ? result.data : String(result);
      setIsLoading(false);
      handleDetected(text);
    } catch {
      setIsLoading(false);
      setErrorMessage('No valid QR code found in the image. Please try again.');
    }
  };

  const handleModalClose = () => {
    stopHardwareCamera(videoRef.current, scannerRef.current);
    scannerRef.current = null;
    onClose();
  };

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleModalClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="qr-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleModalClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Scan QR Code"
    >
      <div
        className={`qr-modal-card ${isDragging ? 'is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer?.files?.[0];
          if (file) handleScanImageFile(file);
        }}
      >
        {/* Modal Header */}
        <div className="qr-modal-header">
          <div className="qr-modal-title-group">
            <div className="qr-modal-title-icon">
              <QrCode size={18} />
            </div>
            <div>
              <h3>Scan Server QR Code</h3>
              <p>Point camera at the QR code displayed in LocalStream</p>
            </div>
          </div>
          <button
            type="button"
            className="qr-modal-close-btn"
            onClick={handleModalClose}
            aria-label="Close scanner"
            title="Close"
          >
            <X size={17} />
          </button>
        </div>

        {/* Viewport */}
        <div className="qr-scanner-viewport">
          <video
            ref={videoRef}
            className="qr-scanner-video"
            playsInline
            muted
          />

          {!errorMessage && (
            <div className={`qr-viewfinder-frame ${scanSuccess ? 'success' : ''}`}>
              <div className="qr-corner top-left" />
              <div className="qr-corner top-right" />
              <div className="qr-corner bottom-left" />
              <div className="qr-corner bottom-right" />
              {!scanSuccess && !isLoading && <div className="qr-laser-line" />}
            </div>
          )}

          {isLoading && !scanSuccess && (
            <div className="qr-overlay-status">
              <Loader2 className="qr-spinner" size={30} />
              <span>Starting camera...</span>
            </div>
          )}

          {scanSuccess && (
            <div className="qr-overlay-success">
              <CheckCircle2 size={44} className="qr-success-icon" />
              <span className="qr-success-title">Connected!</span>
              <span className="qr-success-text">{scannedResultText}</span>
            </div>
          )}

          {errorMessage && (
            <div className="qr-overlay-error">
              <AlertCircle size={36} className="qr-error-icon" />
              <p className="qr-error-message">{errorMessage}</p>
              <button
                type="button"
                className="qr-error-action-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={14} />
                <span>Upload QR Image Instead</span>
              </button>
            </div>
          )}
        </div>

        {/* Modal Controls */}
        <div className="qr-modal-controls">
          <div className="qr-control-buttons">
            {cameras.length > 1 && (
              <button
                type="button"
                className="qr-control-btn"
                onClick={handleSwitchCamera}
                title="Switch camera"
              >
                <SwitchCamera size={15} />
                <span>Flip Camera</span>
              </button>
            )}

            {hasFlash && (
              <button
                type="button"
                className={`qr-control-btn ${isFlashOn ? 'active' : ''}`}
                onClick={handleToggleFlash}
                title={isFlashOn ? 'Turn off flash' : 'Turn on flash'}
              >
                {isFlashOn ? <ZapOff size={15} /> : <Zap size={15} />}
                <span>{isFlashOn ? 'Flash Off' : 'Flash'}</span>
              </button>
            )}

            <button
              type="button"
              className="qr-control-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Upload image of QR code"
            >
              <Upload size={15} />
              <span>Upload Image</span>
            </button>
          </div>

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleScanImageFile(file);
              e.target.value = '';
            }}
          />

          <p className="qr-modal-hint">
            You can also drag & drop a QR screenshot here
          </p>
        </div>
      </div>
    </div>
  );
}
