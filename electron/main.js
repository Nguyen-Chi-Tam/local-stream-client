const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '..', 'dist', 'localstream.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  win.loadFile(indexPath);
}

app.whenReady().then(() => {
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
