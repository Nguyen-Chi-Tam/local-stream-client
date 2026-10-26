const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');

const YTM_API_ORIGIN = 'https://music.youtube.com';
const YTM_ALLOWED_PATHS = new Set(['search', 'next', 'browse']);
const YTM_CLIENT_VERSION = '1.20261026.01.00';

// Innertube responses are unreadable from a browser context because YouTube
// rejects cross-origin calls, so the renderer delegates them to the main
// process. Only the three endpoints used by the lyrics provider are allowed.
async function requestYouTubeMusic(request) {
  const endpoint = typeof request?.path === 'string' ? request.path : '';
  if (!YTM_ALLOWED_PATHS.has(endpoint)) {
    throw new Error('Unsupported YouTube Music endpoint');
  }
  if (!request?.body || typeof request.body !== 'object') {
    throw new Error('Invalid YouTube Music request body');
  }

  const response = await fetch(`${YTM_API_ORIGIN}/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept-language': 'en-US,en;q=0.9',
      'X-YouTube-Client-Name': '67',
      'X-YouTube-Client-Version': YTM_CLIENT_VERSION,
    },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`YouTube Music HTTP ${response.status}`);
  }
  return response.json();
}

function isExternalUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'dist', 'lsclient.png'),

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
    },
  });

  win.setMenuBarVisibility(false);

  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  win.loadFile(indexPath);

  // Keep external links out of Electron windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL() && isExternalUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Listen for zoom events from renderer
  ipcMain.on('zoom-in', () => {
    const current = win.webContents.getZoomFactor();
    win.webContents.setZoomFactor(Math.min(current + 0.1, 3));
  });
  ipcMain.on('zoom-out', () => {
    const current = win.webContents.getZoomFactor();
    win.webContents.setZoomFactor(Math.max(current - 0.1, 0.25));
  });
  ipcMain.on('zoom-reset', () => {
    win.webContents.setZoomFactor(1);
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ipcMain.handle('ytmusic:innertube', (_event, request) => requestYouTubeMusic(request));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
