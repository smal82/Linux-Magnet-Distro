const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  fetchFeed: () => ipcRenderer.invoke('fetch-feed'),
  getAppPath: () => ipcRenderer.invoke('get-app-path') // Se ne hai ancora bisogno
});