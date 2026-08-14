/**
 * The only bridge between the page and the system.
 *
 * Deliberately narrow: hands bytes to the main process for a user-confirmed
 * "save as" or for the system share sheet. The page gets no file system access
 * of its own — it can neither choose where a file lands nor read one back.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yoman', {
  saveFile: (name, data) => ipcRenderer.invoke('yoman:saveFile', name, data),
  shareFile: (name, data) => ipcRenderer.invoke('yoman:shareFile', name, data),
  /**
   * Writes a backup without a dialog. The page supplies a name and bytes; the
   * folder is chosen by the main process, so this grants no ability to write
   * anywhere of the page's choosing.
   */
  autoBackup: (name, data) => ipcRenderer.invoke('yoman:autoBackup', name, data),
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
