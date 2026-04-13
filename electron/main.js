const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');

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
    icon: path.join(__dirname, '..', 'dist', 'localstream.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
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
