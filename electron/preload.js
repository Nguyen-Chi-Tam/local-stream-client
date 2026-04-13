const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronZoom', {
  zoomIn: () => ipcRenderer.send('zoom-in'),
  zoomOut: () => ipcRenderer.send('zoom-out'),
  zoomReset: () => ipcRenderer.send('zoom-reset'),
});
