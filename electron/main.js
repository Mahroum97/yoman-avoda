/**
 * macOS application shell.
 *
 * The window loads the same built app as the website (dist/), so there is one
 * codebase and one set of behaviour. What the desktop build adds is a native
 * save dialog for exports and a Hebrew menu bar.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// The diary lives in this window's storage, so closing it ends the session.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
