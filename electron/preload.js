const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronZoom', {
  zoomIn: () => ipcRenderer.send('zoom-in'),
  zoomOut: () => ipcRenderer.send('zoom-out'),
  zoomReset: () => ipcRenderer.send('zoom-reset'),
});

contextBridge.exposeInMainWorld('electronLyrics', {
  innertube: (payload) => ipcRenderer.invoke('ytmusic:innertube', payload),
});
