/** Fresh browser storage and synthetic projects only; never an installed diary profile. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.YOMAN_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.YOMAN_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 850 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem('yoman-lang', 'en');
    localStorage.setItem('yoman-theme', 'light');
    window.__savedFiles = [];
    window.__sharedFiles = [];
    window.yoman = {
      platform: 'darwin',
      version: 'route-errors-test',
      saveFile: async (name, bytes) => {
        window.__savedFiles.push({ name, bytes: Array.from(bytes) });
        return { saved: true };
      },
      shareFile: async (name, bytes) => {
        window.__sharedFiles.push({ name, bytes: Array.from(bytes) });
        return { shared: true };
      },
    };
  });

  await page.goto(base);
  const seed = await page.evaluate(async () => {
    const { db, blankEntry, ACTIVE_PROJECT_KEY } = await import('/src/db.ts');
    const now = Date.now();
    const projectAId = await db.projects.add({
      uid: 'route-project-a', name: 'Route Project A', address: 'A address', company: 'A company',
      archived: false, createdAt: now, updatedAt: now,
    });
    const projectBId = await db.projects.add({
      uid: 'route-project-b', name: 'Route Project B', address: 'B address', company: 'B company',
      archived: false, createdAt: now + 1, updatedAt: now + 1,
    });
    const entryAId = await db.entries.add({
      ...blankEntry(projectAId, '2026-08-01', 'route-project-a'),
      uid: 'route-entry-a', weather: 'Clear', workDescription: 'A ONLY WORK',
    });
    const occupiedAId = await db.entries.add({
      ...blankEntry(projectAId, '2026-08-02', 'route-project-a'),
      uid: 'route-entry-a-occupied', weather: 'Cloudy', workDescription: 'OCCUPIED A DAY',
    });
    const trashedAId = await db.entries.add({
      ...blankEntry(projectAId, '2026-08-03', 'route-project-a'),
      uid: 'route-entry-a-trashed', deletedAt: now,
    });
    const orphanId = await db.entries.add({
      ...blankEntry(987654, '2026-08-04', 'route-project-gone'),
      uid: 'route-entry-orphan',
    });
    await db.settings.put({ key: ACTIVE_PROJECT_KEY, value: projectBId });
    location.hash = `/entry/${entryAId}`;
    return { projectAId, projectBId, entryAId, occupiedAId, trashedAId, orphanId };
  });

  const go = async hash => {
    await page.evaluate(next => { location.hash = next; }, hash);
    await page.waitForFunction(next => location.hash === `#${next}`, hash);
  };
  const openActions = async () => {
    const button = page.getByRole('button', { name: 'Share and export', exact: true });
    await button.waitFor();
    await button.click();
    await page.getByRole('menu').waitFor();
  };

  // A stale link to Project A must carry A through the shell, editor, preview
  // and exported document even while Project B is the active diary project.
  await page.locator('h1').filter({ hasText: '01/08/2026' }).waitFor();
  assert.equal(await page.locator('.topbar__title').textContent(), 'Route Project A');
  assert(!(await page.locator('body').textContent()).includes('Route Project B'));
  await openActions();
  await page.getByRole('menuitem', { name: /Create PDF/ }).click();
  await page.waitForFunction(() => window.__savedFiles.length === 1);
  const foreignExport = await page.evaluate(() => window.__savedFiles[0]);
  assert(foreignExport.name.includes('Route Project A'), foreignExport.name);
  await mkdir('tmp', { recursive: true });
  await writeFile('tmp/check-route-owner.pdf', Buffer.from(foreignExport.bytes));
  const foreignText = execFileSync('pdftotext', ['tmp/check-route-owner.pdf', '-'], { encoding: 'utf8' });
  assert(foreignText.includes('Route Project A'));
  assert(foreignText.includes('A ONLY WORK'));
  assert(!foreignText.includes('Route Project B'));

  await go(`/preview/${seed.entryAId}`);
  await page.locator('.sheet').waitFor();
  assert.equal(await page.locator('.sheet__band-sub').first().textContent(), 'Route Project A');
  assert(!(await page.locator('.sheet').textContent()).includes('Route Project B'));

  const beforeBrokenRoutes = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    return db.entries.count();
  });

  // Missing ids are recovery screens. Waiting beyond autosave proves the old
  // `loaded ?? fresh()` path can no longer turn a broken URL into a new day.
  for (const hash of ['/entry/999999', '/preview/999999']) {
    await go(hash);
    await page.getByText('Page not found', { exact: true }).waitFor();
    assert.equal(await page.locator('.actionbar').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Create PDF', exact: true }).count(), 0);
  }
  await page.waitForTimeout(1400);

  for (const hash of [`/entry/${seed.trashedAId}`, `/preview/${seed.trashedAId}`]) {
    await go(hash);
    await page.getByText('This page is in the Trash', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Create PDF', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Restore', exact: true }).count(), 1);
  }

  for (const hash of [`/entry/${seed.orphanId}`, `/preview/${seed.orphanId}`]) {
    await go(hash);
    await page.getByText("This page's project is missing", { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Create PDF', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Share', exact: true }).count(), 0);
  }

  assert.equal(await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    return db.entries.count();
  }), beforeBrokenRoutes);

  // A date clash leaves the visible draft in place, but PDF and share must
  // both stop when the attempted prerequisite save is refused.
  await go(`/entry/${seed.entryAId}`);
  const dateToggle = page.locator('#section-date > .card__toggle');
  await dateToggle.waitFor();
  if (await dateToggle.getAttribute('aria-expanded') !== 'true') await dateToggle.click();
  await page.getByLabel('Date', { exact: true }).fill('2026-08-02');
  const savedBeforeConflict = await page.evaluate(() => window.__savedFiles.length);
  await openActions();
  await page.getByRole('menuitem', { name: /Create PDF/ }).click();
  await page.getByText('An entry already exists for this date', { exact: true }).first().waitFor();
  assert.equal(await page.evaluate(() => window.__savedFiles.length), savedBeforeConflict);

  await openActions();
  await page.getByRole('menuitem', { name: /^Share/ }).click();
  await page.getByText('An entry already exists for this date', { exact: true }).first().waitFor();
  assert.equal(await page.evaluate(() => window.__sharedFiles.length), 0);
  assert.equal(await page.getByLabel('Date', { exact: true }).inputValue(), '2026-08-02');
  assert.equal(await page.evaluate(async id => {
    const { db } = await import('/src/db.ts');
    return (await db.entries.get(id)).date;
  }, seed.entryAId), '2026-08-01');

  // The in-flight ref closes the same-tick gap before React can disable Save.
  await go('/projects');
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await dialog.getByLabel('Project name', { exact: true }).fill('Double Tap Project');
  await dialog.getByRole('button', { name: 'Save', exact: true }).evaluate(button => {
    button.click();
    button.click();
  });
  await page.waitForFunction(async () => {
    const { db } = await import('/src/db.ts');
    return await db.projects.filter(project => project.name === 'Double Tap Project').count() === 1;
  });
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    return db.projects.filter(project => project.name === 'Double Tap Project').count();
  }), 1);

  // A real rejected write keeps the dialog and its input, and releases the
  // busy guard so the user can retry. Only this disposable Table instance is
  // patched; it is restored before the context closes.
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  const failedName = dialog.getByLabel('Project name', { exact: true });
  await failedName.fill('Retained After Failure');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    window.__restoreProjectAdd = () => { IDBObjectStore.prototype.add = original; };
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'projects') throw new DOMException('synthetic project write failure', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('The project was not saved. Your details are still in the form.', { exact: true }).waitFor();
  assert(await dialog.isVisible());
  assert.equal(await failedName.inputValue(), 'Retained After Failure');
  assert(!(await dialog.getByRole('button', { name: 'Save', exact: true }).isDisabled()));
  await page.evaluate(() => window.__restoreProjectAdd());

  assert.deepEqual(errors, []);
  console.log('Route/error checks passed: owner-correct editor/preview/export, missing/deleted/orphan recovery, no accidental pages, conflict-blocked PDF/share, double-tap project guard and retained failed mutation input.');
} finally {
  await browser.close();
}
