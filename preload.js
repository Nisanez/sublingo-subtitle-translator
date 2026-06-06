// preload.js — secure bridge between renderer and main
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sublingo', {
  listModels: () => ipcRenderer.invoke('list-models'),
  pickSrt: () => ipcRenderer.invoke('pick-srt'),
  pickText: (o) => ipcRenderer.invoke('pick-text', o),
  saveText: (o) => ipcRenderer.invoke('save-text', o),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  writeFile: (o) => ipcRenderer.invoke('write-file', o),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  setWindowMode: (m) => ipcRenderer.invoke('set-window-mode', m),
  extractNames: (o) => ipcRenderer.invoke('extract-names', o),
  previewPrompt: (o) => ipcRenderer.invoke('preview-prompt', o),
  translate: (o) => ipcRenderer.invoke('translate', o),
  cancelTranslate: () => ipcRenderer.invoke('cancel-translate'),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (d) => ipcRenderer.invoke('save-settings', d),
  onProgress: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('translate:progress', fn);
    return () => ipcRenderer.removeListener('translate:progress', fn);
  },
});
