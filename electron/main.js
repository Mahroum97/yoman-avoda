/**
 * macOS application shell.
 *
 * The window loads the same built app as the website (dist/), so there is one
 * codebase and one set of behaviour. What the desktop build adds is a native
 * save dialog for exports and a Hebrew menu bar.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, ShareMenu } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  ANSWER_TIMEOUT_MS,
  regenerateCode,
  startSyncServer,
  status as syncStatus,
  stopSyncServer,
} from './sync-server.js';

const here = dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.YOMAN_DEV_URL;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    title: 'יומן עבודה',
    backgroundColor: '#0f2d4a',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL(process.env.YOMAN_DEV_URL);
  } else {
    mainWindow.loadFile(join(here, '..', 'dist', 'index.html'));
  }

  // Anything that is not the app itself opens in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/*
 * Local-network sync. The server cannot read the diary itself — IndexedDB
 * belongs to the renderer — so each request is forwarded to the window and the
 * reply is matched back up by id.
 */
const pendingAnswers = new Map();

function askRenderer(payload) {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      reject(new Error('window is closed'));
      return;
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pendingAnswers.delete(id);
      reject(new Error('the app did not answer in time'));
    }, ANSWER_TIMEOUT_MS);

    pendingAnswers.set(id, { resolve, reject, timer });
    mainWindow.webContents.send('yoman:sync-request', id, payload);
  });
}

ipcMain.on('yoman:sync-response', (_event, id, answer, error) => {
  const pending = pendingAnswers.get(id);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingAnswers.delete(id);
  if (error) pending.reject(new Error(error));
  else pending.resolve(answer);
});

ipcMain.handle('yoman:sync-status', () => syncStatus());
ipcMain.handle('yoman:sync-new-code', () => regenerateCode());
ipcMain.handle('yoman:sync-start', () => startSyncServer(askRenderer));
ipcMain.handle('yoman:sync-stop', () => {
  stopSyncServer();
  return syncStatus();
});

/** Exports arrive here as bytes and go out through a real "save as" dialog. */
ipcMain.handle('yoman:saveFile', async (_event, name, data) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'שמירת קובץ',
    defaultPath: name,
    buttonLabel: 'שמור',
  });
  if (canceled || !filePath) return { saved: false };

  await writeFile(filePath, Buffer.from(data));
  shell.showItemInFolder(filePath);
  return { saved: true, path: filePath };
});

/**
 * The macOS share sheet — WhatsApp, Mail, Messages, AirDrop.
 *
 * The phone has had this all along: on iOS every export goes out through the
 * share sheet because there is no downloads folder. The Mac only ever had a
 * "save as" dialog, so sending a day's report to someone meant saving it and
 * then finding it again in another app. `ShareMenu` is the same picker Finder
 * uses, and it needs a real file on disk, so the bytes are written to a
 * temporary copy first.
 */
ipcMain.handle('yoman:shareFile', async (_event, name, data) => {
  // ShareMenu is macOS-only; elsewhere the renderer falls back to saving.
  if (process.platform !== 'darwin' || !mainWindow) return { shared: false };

  try {
    const dir = join(app.getPath('temp'), 'yoman-share');
    await mkdir(dir, { recursive: true });
    // `name` is built in the renderer from the project name, so it is treated
    // as untrusted here: `basename` keeps a crafted name from escaping the
    // temp directory and writing somewhere it should not.
    const file = join(dir, basename(String(name)) || 'yoman.pdf');
    await writeFile(file, Buffer.from(data));

    new ShareMenu({ filePaths: [file] }).popup({ window: mainWindow });
    return { shared: true };
  } catch (error) {
    // Falling back to the save dialog is better than nothing happening.
    return { shared: false, error: String(error?.message ?? error) };
  }
});

function buildMenu() {
  const template = [
    {
      label: 'יומן עבודה',
      submenu: [
        { role: 'about', label: 'אודות יומן עבודה' },
        { type: 'separator' },
        { role: 'hide', label: 'הסתר' },
        { role: 'hideOthers', label: 'הסתר אחרים' },
        { role: 'unhide', label: 'הצג הכול' },
        { type: 'separator' },
        { role: 'quit', label: 'יציאה' },
      ],
    },
    {
      label: 'עריכה',
      submenu: [
        { role: 'undo', label: 'בטל' },
        { role: 'redo', label: 'בצע שוב' },
        { type: 'separator' },
        { role: 'cut', label: 'גזור' },
        { role: 'copy', label: 'העתק' },
        { role: 'paste', label: 'הדבק' },
        { role: 'selectAll', label: 'בחר הכול' },
      ],
    },
    {
      label: 'תצוגה',
      submenu: [
        { role: 'reload', label: 'רענן' },
        { role: 'resetZoom', label: 'גודל רגיל' },
        { role: 'zoomIn', label: 'הגדל' },
        { role: 'zoomOut', label: 'הקטן' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'מסך מלא' },
        { role: 'toggleDevTools', label: 'כלי פיתוח' },
      ],
    },
    {
      label: 'חלון',
      submenu: [
        { role: 'minimize', label: 'מזער' },
        { role: 'zoom', label: 'הגדל חלון' },
        { role: 'close', label: 'סגור' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  startSyncServer(askRenderer);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// The diary lives in this window's storage, so closing it ends the session.
app.on('window-all-closed', () => {
  stopSyncServer();
  if (process.platform !== 'darwin') app.quit();
});
