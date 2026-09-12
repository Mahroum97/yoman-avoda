/** Disposable browser context for the responsive Cards workspace only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.YOMAN_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.YOMAN_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1320, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('yoman-lang', 'en');
    localStorage.setItem('yoman-theme', 'light');
  });
  await page.goto(base);
  const currentId = await page.evaluate(async () => {
    const { db, blankEntry, ACTIVE_PROJECT_KEY } = await import('/src/db.ts');
    const now = Date.now();
    const projectId = await db.projects.add({
      uid: 'cards-project', name: 'Cards QA Site', address: 'Synthetic address', company: 'Cards QA',
      archived: false, createdAt: now, updatedAt: now,
    });
    const older = blankEntry(projectId, '2026-09-10', 'cards-project');
    await db.entries.add({
      ...older,
      uid: 'cards-older-day',
      managerSignature: 'data:image/png;base64,invalid-test-signature',
      status: 'signed',
    });
    const currentId = await db.entries.add({
      ...blankEntry(projectId, '2026-09-11', 'cards-project'),
      uid: 'cards-current-day',
      weather: 'Clear',
    });
    await db.settings.put({ key: ACTIVE_PROJECT_KEY, value: projectId });
    location.hash = `/entry/${currentId}`;
    return currentId;
  });

  await page.locator('.cards-editor-preview .sheet').waitFor();
  assert(await page.locator('.app--cards[data-section="entry"]').isVisible());
  assert(await page.locator('.cards-sidebar').isVisible());
  assert.equal(await page.locator('.cards-sidebar .nav__item').count(), 5);
  assert.equal(await page.locator('.topbar__icon--theme').count(), 0);
  assert.equal(await page.locator('.cards-day-item').count(), 2);
  assert.equal(await page.locator('.cards-day-item[aria-current="page"]').count(), 1);
  assert((await page.locator('.cards-day-item[aria-current="page"]').textContent()).includes('11/09/2026'));
  assert.equal(await page.locator('.cards-day-status--signed').count(), 1);
  assert.equal(await page.locator('.cards-editor-preview .sheet__band-sub').textContent(), 'Cards QA Site');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '#292929');

  const workToggle = page.locator('#section-work > .card__toggle');
  await workToggle.click();
  const description = page.locator('#section-work textarea');
  await description.fill('LIVE A4 PREVIEW CHANGE');
  await page.locator('.cards-editor-preview .sheet').getByText('LIVE A4 PREVIEW CHANGE', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  const dialog = page.locator('dialog.cards-document-dialog[open]');
  await dialog.waitFor();
  assert.equal(await dialog.locator('.sheet').count(), 1);
  assert((await dialog.locator('.sheet').textContent()).includes('LIVE A4 PREVIEW CHANGE'));
  await dialog.locator('button').click();
  await dialog.waitFor({ state: 'detached' });

  await mkdir('tmp', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'tmp/check-cards-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => !document.querySelector('.cards-day-navigation'));
  assert.equal(await page.locator('.cards-editor-preview').count(), 0);
  assert(await page.locator('.cards-editor-form').isVisible());
  assert.equal(await page.locator('.nav__item').count(), 5);
  assert.equal(await page.locator('.nav__item').nth(2).textContent(), 'New');
  assert.equal(await page.locator('.nav').evaluate(element => getComputedStyle(element).position), 'fixed');
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  const settingsBox = await settings.boundingBox();
  assert(settingsBox && settingsBox.x > 300, 'Settings is not at the physical upper-right');
  await settings.click();
  await page.waitForFunction(() => location.hash === '#/settings');
  await page.getByRole('heading', { name: 'Appearance', exact: true }).waitFor();
  assert.equal(await page.locator('.nav').getByRole('button', { name: 'Settings' }).count(), 0);
  await page.getByRole('button', { name: /Night/ }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.getByRole('button', { name: /^Black/ }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'black');
  await page.getByRole('button', { name: /^Day/ }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'tmp/check-cards-phone.png', fullPage: true });

  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  await page.waitForFunction(() => location.hash === '#/reports');
  await page.getByRole('heading', { name: 'Combined report', exact: true }).waitFor();
  assert.equal(currentId > 0, true);
  assert.deepEqual(errors, []);

  const macContext = await browser.newContext({ viewport: { width: 1320, height: 760 } });
  await macContext.addInitScript(() => {
    localStorage.setItem('yoman-lang', 'en');
    localStorage.setItem('yoman-theme', 'dark');
    window.yoman = { platform: 'darwin', version: 'test' };
  });
  const macPage = await macContext.newPage();
  await macPage.goto(base);
  await macPage.locator('.topbar').waitFor();
  assert.equal(await macPage.locator('html').getAttribute('data-desktop'), 'true');
  assert.equal(await macPage.locator('.topbar__logo').evaluate(el => getComputedStyle(el).display), 'none');
  assert.equal(await macPage.locator('.topbar__grow').evaluate(el => getComputedStyle(el).display), 'none');
  const macSettings = await macPage.locator('.topbar__icon--settings').boundingBox();
  const macBackup = await macPage.locator('.topbar__icon--backup').boundingBox();
  assert(macSettings && macBackup && macSettings.x > 1240 && macBackup.x > 1180,
    'Mac toolbar controls are not kept at the physical right');
  assert(macSettings.x > macBackup.x, 'Settings is not the upper-right Mac control');
  const macBrand = await macPage.locator('.cards-sidebar__brand').boundingBox();
  assert(macBrand && macBrand.y >= 50, 'English sidebar brand overlaps the Mac traffic lights');
  await macPage.screenshot({ path: 'tmp/check-cards-mac-toolbar.png' });
  await macContext.close();
  console.log('Cards workspace checks passed: neutral app palette, desktop navigation/current state, live shared A4 preview and dialog, phone form/tab controls and no horizontal overflow.');
} finally {
  await browser.close();
}
