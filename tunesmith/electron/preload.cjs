// The only bridge between the app page and the desktop: a few named calls.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tunesmith', {
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  setKey: (key) => ipcRenderer.invoke('ai:setKey', key),
  suggest: (payload) => ipcRenderer.invoke('ai:suggest', payload),
  saveFile: (name, data, filters) => ipcRenderer.invoke('file:save', { name, data, filters }),
  openFile: () => ipcRenderer.invoke('file:open'),
});
