/**
 * Native desktop workflow regression.
 *
 * This launches the real Electron main/preload/renderer stack against Vite,
 * but redirects Chromium storage and Documents into one disposable directory.
 * The QA bootstrap also turns the fixed LAN sync socket into a no-op so a test
 * process can never become a sync peer for an installed diary.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightPath = process.env.YOMAN_PLAYWRIGHT_PATH || 'playwright';
const { _electron: electron } = require(playwrightPath);
const electronExecutable = require('electron');
const base = process.env.YOMAN_BASE_URL || 'http://127.0.0.1:5182';
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const qaRoot = await mkdtemp(join(tmpdir(), 'yoman-electron-qa-'));
const profileDir = join(qaRoot, 'profile');
const documentsDir = join(qaRoot, 'Documents');
const outputDir = join(qaRoot, 'output');
const screenshotsDir = process.env.YOMAN_QA_SCREENSHOTS || join(projectRoot, 'tmp', 'desktop-electron-qa');
const bootstrapPath = join(qaRoot, 'electron-qa-bootstrap.mjs');
await Promise.all([
  mkdir(profileDir, { recursive: true }),
  mkdir(documentsDir, { recursive: true }),
  mkdir(outputDir, { recursive: true }),
  mkdir(screenshotsDir, { recursive: true }),
]);

const mainUrl = pathToFileURL(join(projectRoot, 'electron', 'main.js')).href;
await writeFile(bootstrapPath, `
import { app, dialog, shell } from 'electron';
import { Server } from 'node:http';

app.setPath('userData', ${JSON.stringify(profileDir)});
app.setPath('documents', ${JSON.stringify(documentsDir)});

// The production server owns a fixed LAN port. In QA it reports as listening
// without opening a socket, and close is paired with the same marker.
const qaSync = Symbol('qa-sync');
const originalListen = Server.prototype.listen;
const originalClose = Server.prototype.close;
Server.prototype.listen = function (...args) {
  if (args[0] === 45231) {
    this[qaSync] = true;
    queueMicrotask(() => this.emit('listening'));
    return this;
  }
  return originalListen.apply(this, args);
};
Server.prototype.close = function (...args) {
  if (this[qaSync]) {
    queueMicrotask(() => this.emit('close'));
    return this;
  }
  return originalClose.apply(this, args);
};

globalThis.__YOMAN_QA_SAVE_PATH = null;
globalThis.__YOMAN_QA_LAST_SAVE_OPTIONS = null;
dialog.showSaveDialog = async (_window, options) => {
  globalThis.__YOMAN_QA_LAST_SAVE_OPTIONS = options;
  const filePath = globalThis.__YOMAN_QA_SAVE_PATH;
  return filePath ? { canceled: false, filePath } : { canceled: true };
};
shell.showItemInFolder = () => '';

await import(${JSON.stringify(mainUrl)});
`, 'utf8');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForFile(file, timeout = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const info = await stat(file);
      if (info.size > 0) return info;
    } catch {
      // Export still in progress.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for exported file: ${file}`);
}

async function waitForJsonBelow(root, timeout = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const files = await readdir(root, { recursive: true }).catch(() => []);
    const json = files.find(file => file.endsWith('.json'));
    if (json) return join(root, json);
    await sleep(100);
  }
  throw new Error(`Timed out waiting for a backup below: ${root}`);
}

const app = await electron.launch({
  executablePath: electronExecutable,
  args: [bootstrapPath],
  cwd: projectRoot,
  env: {
    ...process.env,
    YOMAN_DEV_URL: base,
    YOMAN_ELECTRON_QA: '1',
  },
  timeout: 30_000,
});

const pageErrors = [];
const consoleErrors = [];
let page;

async function strings() {
  return page.evaluate(async () => {
    const { currentStrings } = await import('/src/i18n/useLanguage.ts');
    return currentStrings();
  });
}

async function setSavePath(file) {
  await app.evaluate((_electron, next) => {
    globalThis.__YOMAN_QA_SAVE_PATH = next;
  }, file);
}

async function saveOptions() {
  return app.evaluate(() => globalThis.__YOMAN_QA_LAST_SAVE_OPTIONS);
}

try {
  page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const native = await app.evaluate(({ app, Menu }) => ({
    userData: app.getPath('userData'),
    documents: app.getPath('documents'),
    menu: Menu.getApplicationMenu()?.items.map(item => ({
      label: item.label,
      submenu: item.submenu?.items.map(child => child.label) ?? [],
    })) ?? [],
  }));
  assert.equal(native.userData, profileDir, 'Electron profile escaped disposable QA storage');
  assert.equal(native.documents, documentsDir, 'Electron Documents escaped disposable QA storage');
  assert.deepEqual(native.menu.map(item => item.label), ['יומן עבודה', 'עריכה', 'תצוגה', 'חלון']);
  assert(native.menu[1].submenu.includes('בטל') && native.menu[2].submenu.includes('רענן'),
    'Native application menu is missing edit/view commands');

  await page.evaluate(() => {
    localStorage.setItem('yoman-lang', 'en');
    localStorage.setItem('yoman-theme', 'light');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.project-setup').waitFor();
  let t = await strings();

  // Empty desktop shell and project creation are exercised entirely by clicks.
  await page.screenshot({ path: join(screenshotsDir, '01-empty-desktop.png'), fullPage: true });
  const navBox = await page.locator('.nav').boundingBox();
  assert(navBox && navBox.width > navBox.height * 2, 'Desktop destinations are not laid out as a top navigation row');
  await page.locator('.project-setup').getByRole('button', { name: t.newProject, exact: true }).click();
  const projectDialog = page.getByRole('dialog');
  await projectDialog.waitFor();
  await projectDialog.getByLabel(t.labelProjectName, { exact: true }).fill('Native Desktop QA');
  await projectDialog.getByLabel(t.labelAddress, { exact: true }).fill('Isolated test site');
  await projectDialog.getByRole('button', { name: t.save, exact: true }).click();
  await projectDialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => location.hash === '#/' || location.hash === '');
  assert.equal(await page.locator('.topbar__app-name').textContent(), t.appName);

  // Default shortcut N opens a fresh day. Save from inside a textarea verifies
  // the field-safe Command-S path before reopening the saved day.
  await page.keyboard.press('KeyN');
  await page.waitForFunction(() => location.hash === '#/entry/new');
  await page.locator('#section-date input[type=date]').fill('2026-09-07');
  await page.locator('#section-work .card__toggle').click();
  const marker = 'Desktop QA concrete pour and drainage inspection';
  const work = page.locator('#section-work textarea');
  await work.fill(marker);
  await page.keyboard.press('Meta+KeyS');
  await page.waitForFunction(() => /^#\/entry\/\d+$/.test(location.hash));
  const entryHash = await page.evaluate(() => location.hash);
  const storedEntry = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    return (await db.entries.toArray())[0];
  });
  assert.equal(storedEntry.date, '2026-09-07');
  assert.equal(storedEntry.workDescription, marker);

  // Diary opens as the desktop document workspace. The day list, A4 document,
  // and delivery inspector all need to be visible at once.
  await page.locator('body').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Digit1');
  await page.locator('.desktop-diary').waitFor();
  await page.locator('.desktop-days').waitFor();
  await page.locator('.desktop-document .sheet').waitFor();
  await page.locator('.desktop-inspector').waitFor();
  const workspaceGeometry = await page.evaluate(() => {
    const workspace = document.querySelector('.desktop-diary').getBoundingClientRect();
    const inspector = document.querySelector('.desktop-inspector').getBoundingClientRect();
    return {
      innerWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      workspace: { left: workspace.left, right: workspace.right, width: workspace.width },
      inspector: { left: inspector.left, right: inspector.right, width: inspector.width },
    };
  });
  assert(workspaceGeometry.scrollWidth <= workspaceGeometry.clientWidth + 1,
    `Desktop workspace causes horizontal overflow: ${JSON.stringify(workspaceGeometry)}`);
  assert(workspaceGeometry.inspector.left >= 0 &&
    workspaceGeometry.inspector.right <= workspaceGeometry.clientWidth + 1,
  `Desktop inspector is clipped: ${JSON.stringify(workspaceGeometry)}`);
  assert.equal(await page.locator('.desktop-days__item').count(), 1);
  assert.equal(await page.locator('.desktop-days__item').first().getAttribute('aria-current'), 'page');
  assert(await page.locator('.desktop-document').getByText(marker, { exact: true }).count(),
    'Saved work text is missing from the desktop document');
  await page.screenshot({ path: join(screenshotsDir, '02-document-workspace.png'), fullPage: true });
  await page.locator('.toast').waitFor({ state: 'hidden', timeout: 10_000 });
  await page.screenshot({ path: join(screenshotsDir, '04-final-workspace.png'), fullPage: false });

  // The desktop rail still exposes the complete diary list for bulk actions.
  await page.getByRole('button', { name: t.desktopAllPages, exact: true }).click();
  await page.waitForFunction(() => new URL(location.href).hash === '#/?view=list');
  await page.getByRole('heading', { name: t.diaryTitle, level: 1, exact: true }).waitFor();
  await page.locator('.nav').getByRole('button', { name: t.navDiary, exact: true }).click();
  await page.locator('.desktop-diary').waitFor();

  // Reopen/edit uses the visible document toolbar, then returns to the same day.
  await page.locator('.desktop-document__toolbar .btn').click();
  await page.waitForFunction(expected => location.hash === expected, entryHash);
  await page.locator('#section-work .card__toggle').click();
  await page.locator('#section-work textarea').waitFor();
  assert.equal(await page.locator('#section-work textarea').inputValue(), marker);

  // Contacts: create and type a row, leave immediately, then verify the pending
  // autosave was flushed into IndexedDB by navigation.
  await page.locator('body').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Digit4');
  await page.getByRole('heading', { name: t.contactsTitle, level: 1, exact: true }).waitFor();
  await page.locator('.contacts__tools').getByRole('button', { name: t.newContact, exact: true }).click();
  const contactName = 'Native QA Supplier';
  await page.getByLabel(t.labelContactName, { exact: true }).fill(contactName);
  await page.getByLabel(t.labelContactTrade, { exact: true }).fill('Electrical');
  await page.getByLabel(t.labelContactPhone, { exact: true }).fill('+972-50-555-0101');
  await page.locator('.nav').getByRole('button', { name: t.navProjects, exact: true }).click();
  await page.getByRole('heading', { name: t.projectsTitle, level: 1, exact: true }).waitFor();
  await page.waitForFunction(async expected => {
    const { db } = await import('/src/db.ts');
    const row = (await db.contacts.toArray())[0];
    return row?.name === expected && row?.trade === 'Electrical';
  }, contactName);

  // Projects: edit the active project through its modal and persist the change.
  await page.getByRole('button', { name: t.editDetails, exact: true }).click();
  const editDialog = page.getByRole('dialog');
  await editDialog.getByLabel(t.labelAddress, { exact: true }).fill('Updated isolated site');
  await editDialog.getByRole('button', { name: t.update, exact: true }).click();
  await editDialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(async () => {
    const { db } = await import('/src/db.ts');
    return (await db.projects.toArray())[0]?.address === 'Updated isolated site';
  });

  // Theme shortcut and Settings controls. Switch to Hebrew and back to prove
  // direction and labels rerender in the native renderer.
  const themeBefore = await page.locator('html').getAttribute('data-theme');
  await page.keyboard.press('KeyT');
  await page.waitForFunction(before => document.documentElement.dataset.theme !== before, themeBefore);
  await page.keyboard.press('Digit5');
  await page.getByRole('heading', { name: t.settingsTitle, level: 1, exact: true }).waitFor();
  await page.getByRole('button', { name: new RegExp(`^${t.themeLight}`) }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.locator('button[lang="he"]').click();
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
  assert.equal(await page.locator('html').getAttribute('lang'), 'he');
  await page.locator('button[lang="en"]').click();
  assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
  t = await strings();

  // Reports is reached by its keyboard shortcut and must see the day made above.
  await page.keyboard.press('Digit2');
  await page.getByRole('heading', { name: t.reportsTitle, level: 1, exact: true }).waitFor();
  await page.waitForFunction(async () => {
    const { db } = await import('/src/db.ts');
    return (await db.entries.toArray()).length === 1;
  });
  await page.screenshot({ path: join(screenshotsDir, '03-reports.png'), fullPage: true });

  // Native IPC save cancellation and successful bytes. The deterministic QA
  // dialog substitute captures the real handler's options without opening an
  // OS sheet that Playwright cannot control.
  await setSavePath(null);
  const canceled = await page.evaluate(() => window.yoman.saveFile(
    'cancel-check.txt', new Uint8Array([99, 97, 110, 99, 101, 108]),
  ));
  assert.deepEqual(canceled, { saved: false });
  assert.equal((await saveOptions()).title, 'שמירת קובץ');

  const bridgeOutput = join(outputDir, 'bridge-success.bin');
  await setSavePath(bridgeOutput);
  const bridged = await page.evaluate(() => window.yoman.saveFile(
    'bridge-success.bin', new Uint8Array([10, 20, 30, 40]),
  ));
  assert.equal(bridged.saved, true);
  assert.deepEqual([...await readFile(bridgeOutput)], [10, 20, 30, 40]);

  // P exercises the report screen's public shortcut and the complete PDF
  // generator -> preload -> IPC -> filesystem route.
  const reportPdf = join(outputDir, 'native-report.pdf');
  await setSavePath(reportPdf);
  await page.locator('h1').first().click();
  await page.keyboard.press('KeyP');
  const pdfInfo = await waitForFile(reportPdf, 45_000);
  const pdfHeader = (await readFile(reportPdf)).subarray(0, 5).toString('ascii');
  assert.equal(pdfHeader, '%PDF-');
  assert(pdfInfo.size > 5_000, `Generated PDF is unexpectedly small: ${pdfInfo.size}`);
  assert(String((await saveOptions()).defaultPath).toLowerCase().endsWith('.pdf'),
    'Report export did not offer a PDF name to the native save handler');

  // B runs the native automatic-backup bridge. app.getPath('documents') was
  // redirected before startup, so this also proves the real Documents target
  // is never touched by the regression.
  await page.locator('h1').first().click();
  await page.keyboard.press('KeyB');
  const backupFile = await waitForJsonBelow(documentsDir);
  assert((await stat(backupFile)).size > 100, 'Native backup file is unexpectedly empty');

  assert.deepEqual(pageErrors, [], `Renderer errors: ${pageErrors.join('\n')}`);
  const result = {
    passed: true,
    baseUrl: base,
    profileDir,
    documentsDir,
    reportPdf,
    reportPdfBytes: pdfInfo.size,
    screenshotsDir,
    entryHash,
    workspaceGeometry,
    backupFile,
    consoleErrors,
  };
  await writeFile(
    join(screenshotsDir, 'native-run.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(screenshotsDir, 'FAIL.png'), fullPage: true }).catch(() => undefined);
    console.error(`FAIL at ${page.url()}`);
  }
  console.error(`Disposable QA root retained for diagnosis: ${qaRoot}`);
  throw error;
} finally {
  await app.close().catch(() => undefined);
}
