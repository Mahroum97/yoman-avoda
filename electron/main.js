/**
 * macOS application shell.
 *
 * The window loads the same built app as the website (dist/), so there is one
 * codebase and one set of behaviour. What the desktop build adds is a native
 * save dialog for exports and a Hebrew menu bar.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, ShareMenu } from 'electron';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
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

  /*
   * The window is created hidden so it appears painted rather than white, and
   * for a long time `ready-to-show` was the *only* thing that could ever show
   * it. When the renderer failed to start, that event never came: the app sat
   * in the Dock with its menu bar up and no window at all — nothing on screen
   * to read and nothing written down. "It doesn't open and I don't know why"
   * was the exact report, and there was no way to answer it.
   *
   * So the window comes up regardless after a few seconds. An empty window that
   * can be reloaded from the menu, or that carries the message below, is worth
   * incomparably more than no window.
   */
  const showAnyway = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.error('the app did not become ready in time; showing the window anyway');
      mainWindow.show();
    }
  }, 8000);

  mainWindow.once('ready-to-show', () => {
    clearTimeout(showAnyway);
    mainWindow.show();
  });

  // A load that fails says so, on screen. `errorCode` -3 is an aborted load,
  // which is what a redirect or a second navigation looks like, not a fault.
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, description, url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    console.error(`load failed: ${description} (${errorCode}) ${url}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      dialog.showErrorBox('יומן עבודה', `הטעינה נכשלה: ${description} (${errorCode})`);
    }
  });

  // The renderer dying takes the diary's screen with it and used to be silent.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`renderer gone: ${details.reason} (exit ${details.exitCode})`);
    dialog.showErrorBox('יומן עבודה', `החלון נסגר במפתיע: ${details.reason}`);
  });

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
 * The automatic backup, written without asking.
 *
 * The page hands over bytes and a file name; *where* they land is decided here
 * and cannot be influenced from the renderer, which is the same bargain the
 * save dialog makes. A folder in Documents rather than a hidden application
 * directory, because a backup nobody can find is not a backup: it is visible in
 * Finder, it is caught by Time Machine and by iCloud Documents, and it can be
 * copied to another machine by dragging it.
 *
 * Old files are pruned here too. Thirty of them is about a month of daily
 * cover, and without a limit a year of automatic backups would quietly fill the
 * disk with copies of the same nine diary pages.
 */
const BACKUP_KEEP = 30;

ipcMain.handle('yoman:autoBackup', async (_event, name, data) => {
  try {
    const dir = join(app.getPath('documents'), 'יומן עבודה - גיבויים');
    await mkdir(dir, { recursive: true });
    // `basename` for the same reason the share sheet uses it: the name is built
    // in the renderer and is treated as untrusted here.
    const file = join(dir, basename(String(name)) || 'backup.json');
    await writeFile(file, Buffer.from(data));

    const kept = (await readdir(dir))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();
    for (const old of kept.slice(BACKUP_KEEP)) {
      await rm(join(dir, old), { force: true });
    }

    return { saved: true, path: file, kept: Math.min(kept.length, BACKUP_KEEP) };
  } catch (error) {
    // Never throws at the caller: a failed backup must not break a save.
    console.error('automatic backup failed:', error?.message ?? error);
    return { saved: false, error: String(error?.message ?? error) };
  }
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

/*
 * One copy of the app, ever.
 *
 * Chromium allows a single process per user-data directory, and the diary lives
 * in that directory's IndexedDB. A second copy therefore cannot open the diary
 * *at all*: the open request never resolves — not an error, not "blocked", no
 * event of any kind — so the window sits on "loading" for as long as you leave
 * it, while the first copy carries on working perfectly. Two instances left
 * running is exactly how this app came to "not open and not say why", and the
 * second copy is invisible unless you go looking in the process list for it.
 *
 * The lock is taken before anything else: a copy that cannot have the diary
 * should not draw a window, start a sync server, or touch the profile.
 */
if (!app.requestSingleInstanceLock()) {
  console.error('another copy of the diary is already running; quitting this one');
  app.quit();
} else {
  // Launching it again — from the Dock, or by double-clicking — raises the
  // window that already has the diary instead of doing nothing visible.
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    startSyncServer(askRenderer);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// The diary lives in this window's storage, so closing it ends the session.
app.on('window-all-closed', () => {
  stopSyncServer();
  if (process.platform !== 'darwin') app.quit();
});
