/**
 * The only bridge between the page and the system.
 *
 * Deliberately narrow: one function that hands bytes to the main process for a
 * user-confirmed "save as". The page gets no file system access of its own.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yoman', {
  saveFile: (name, data) => ipcRenderer.invoke('yoman:saveFile', name, data),
  platform: process.platform,
  version: process.versions.electron,
});
