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

  sync: {
    status: () => ipcRenderer.invoke('yoman:sync-status'),
    newCode: () => ipcRenderer.invoke('yoman:sync-new-code'),
    start: () => ipcRenderer.invoke('yoman:sync-start'),
    stop: () => ipcRenderer.invoke('yoman:sync-stop'),

    /**
     * The page registers the function that answers sync requests. Requests
     * arrive from the LAN server in the main process; the answer travels back
     * tagged with the same id.
     */
    onRequest: (handler) => {
      ipcRenderer.removeAllListeners('yoman:sync-request');
      ipcRenderer.on('yoman:sync-request', async (_event, id, payload) => {
        try {
          const answer = await handler(payload);
          ipcRenderer.send('yoman:sync-response', id, answer, null);
        } catch (error) {
          ipcRenderer.send('yoman:sync-response', id, null, String(error?.message ?? error));
        }
      });
    },
  },
});
