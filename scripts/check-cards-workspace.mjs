/** Disposable browser context for the responsive Cards workspace only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.YOMAN_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.YOMAN_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  headless: true,
  ...(process.env.YOMAN_CHROMIUM_PATH
    ? { executablePath: process.env.YOMAN_CHROMIUM_PATH }
    : {}),
});

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
  assert.equal(await page.locator('.cards-sidebar .nav').evaluate(element => getComputedStyle(element).flexDirection), 'row');
  const wideTabs = await page.locator('.cards-sidebar .nav__item').evaluateAll(elements =>
    elements.map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );
  assert(wideTabs.every(tab => Math.abs(tab.y - wideTabs[0].y) < 2), 'Desktop tabs are not horizontal');
  assert(wideTabs[2].x > wideTabs[4].x + wideTabs[4].width,
    'English New tab is not separated at the far end of the desktop row');
  assert.equal(await page.locator('.topbar__icon--theme').count(), 0);
  assert.notEqual(await page.locator('.topbar__logo').evaluate(el => getComputedStyle(el).display), 'none');
  assert(await page.locator('.topbar__app-name').isVisible());
  assert.equal(await page.locator('.topbar__title').textContent(), 'Cards QA Site');
  assert.equal(await page.locator('.cards-editor-shell > .cards-day-navigation').count(), 1);
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
  assert.notEqual(await macPage.locator('.topbar__logo').evaluate(el => getComputedStyle(el).display), 'none');
  assert.notEqual(await macPage.locator('.topbar__grow').evaluate(el => getComputedStyle(el).display), 'none');
  const macSettings = await macPage.locator('.topbar__icon--settings').boundingBox();
  const macBackup = await macPage.locator('.topbar__icon--backup').boundingBox();
  assert(macSettings && macBackup && macSettings.x > 1240,
    'Mac Settings control is not kept at the physical right');
  assert(macSettings.x > macBackup.x, 'Settings is not the upper-right Mac control');
  assert(macBackup.x >= 88, 'Mac Backup control overlaps the traffic-light clearance');
  const macLogo = await macPage.locator('.topbar__logo').boundingBox();
  assert(macLogo && macLogo.x + macLogo.width <= macSettings.x,
    'Mac app identity is not adjacent to the Settings end of the toolbar');
  const macTopbar = await macPage.locator('.topbar').boundingBox();
  assert(macTopbar && macTopbar.x === 0 && macTopbar.width === 1320,
    'Mac top bar does not preserve its full-width drag region');
  await macPage.screenshot({ path: 'tmp/check-cards-mac-toolbar.png' });
  await macContext.close();

  const rtlContext = await browser.newContext({ viewport: { width: 1320, height: 760 } });
  await rtlContext.addInitScript(() => {
    localStorage.setItem('yoman-lang', 'he');
    localStorage.setItem('yoman-theme', 'dark');
  });
  const rtlPage = await rtlContext.newPage();
  await rtlPage.goto(base);
  await rtlPage.locator('.cards-sidebar .nav').waitFor();
  assert.notEqual(await rtlPage.locator('.topbar__logo').evaluate(el => getComputedStyle(el).display), 'none');
  assert.notEqual(await rtlPage.locator('.topbar__grow--app').evaluate(el => getComputedStyle(el).display), 'none');
  const rtlSettings = await rtlPage.locator('.topbar__icon--settings').boundingBox();
  const rtlBackup = await rtlPage.locator('.topbar__icon--backup').boundingBox();
  assert(rtlSettings && rtlBackup && rtlSettings.x > rtlBackup.x,
    'RTL website does not keep Settings at the upper-right of the content toolbar');
  const rtlTabs = await rtlPage.locator('.cards-sidebar .nav__item').evaluateAll(elements =>
    elements.map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width };
    }),
  );
  assert(rtlTabs.every(tab => Math.abs(tab.y - rtlTabs[0].y) < 2), 'RTL desktop tabs are not horizontal');
  assert(rtlTabs[2].x + rtlTabs[2].width < rtlTabs[4].x,
    'RTL New tab is not separated at the far end of the desktop row');
  await rtlPage.screenshot({ path: 'tmp/check-cards-web-rtl.png' });
  await rtlContext.close();
  console.log('Cards workspace checks passed: neutral app palette, horizontal desktop navigation/current state, editor day rail, live shared A4 preview and dialog, phone form/tab controls and no horizontal overflow.');
} finally {
  await browser.close();
}
