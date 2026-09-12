/** iPhone touch regressions. Uses a fresh synthetic diary, never installed app data. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.YOMAN_PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ...devices['iPhone 14'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem('yoman-lang', 'en');
  localStorage.setItem('yoman-theme', 'light');
});
const base = process.env.YOMAN_BASE_URL || 'http://127.0.0.1:5173';
try {
  await page.goto(base);
  await page.getByRole('button', { name: 'New project', exact: true }).tap();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project name', { exact: true }).fill('Touch QA');
  await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
  await dialog.waitFor({ state: 'hidden' });
  const newButton = page.locator('.nav__item--new');
  await newButton.tap();
  const date = page.locator('#section-date input[type=date]');
  await date.fill('2026-09-01');
  await page.locator('.actionbar__inner .btn--primary').tap();
  await page.waitForFunction(() => /^#\/entry\/\d+$/.test(location.hash));
  const firstHash = await page.evaluate(() => location.hash);
  await newButton.tap();
  await page.waitForFunction(() => document.querySelector('input[type=date]')?.value !== '2026-09-01');
  // Repeated New on the same hash must also produce a fresh form.
  await date.fill('2026-09-02');
  await newButton.tap();
  await page.waitForFunction(() => document.querySelector('input[type=date]')?.value !== '2026-09-02');
  const records = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    return (await db.entries.toArray()).map(entry => entry.date);
  });
  assert(records.includes('2026-09-01'), 'New must preserve the previously saved day');
  assert(records.includes('2026-09-02'), 'New must flush the draft before leaving it');

  // Every section must react to a touch, in both writing directions.
  for (const lang of ['en', 'he']) {
    await page.evaluate(async lang => {
      const { applyLanguage } = await import('/src/i18n/useLanguage.ts');
      localStorage.setItem('yoman-lang', lang);
      applyLanguage(lang);
      window.dispatchEvent(new Event('yoman-language'));
    }, lang);
    const count = await page.locator('.sectionrail__chip').count();
    for (let i = 1; i <= count; i++) {
      const chip = page.locator('.sectionrail__chip').nth(i % count);
      const label = await chip.textContent();
      await chip.tap();
      await page.waitForFunction(label => {
        const title = document.querySelector('.card__toggle[aria-expanded=true] .card__toggle-title');
        return title?.textContent === label;
      }, label);
      await page.waitForFunction(() => {
        const toggle = document.querySelector('.card__toggle[aria-expanded=true]');
        return toggle.getBoundingClientRect().top >= document.querySelector('.chrome').getBoundingClientRect().bottom;
      });
    }
  }
  await page.evaluate(async () => {
    const { applyLanguage } = await import('/src/i18n/useLanguage.ts');
    localStorage.setItem('yoman-lang', 'en');
    applyLanguage('en');
    window.dispatchEvent(new Event('yoman-language'));
  });

  // Menu must scroll to its last action when the available height is short.
  await page.setViewportSize({ width: 390, height: 360 });
  await page.locator('.actionmenu__button').tap();
  const menu = page.getByRole('menu');
  const menuBounds = await menu.boundingBox();
  assert(menuBounds.y >= 0 && menuBounds.y + menuBounds.height <= 360, 'Menu escapes the visible screen');
  await page.getByRole('menuitem').last().scrollIntoViewIfNeeded();
  const last = await page.getByRole('menuitem').last().boundingBox();
  assert(last.y >= menuBounds.y && last.y + last.height <= menuBounds.y + menuBounds.height, 'Last action cannot be reached');
  await page.locator('.nav__item').nth(1).tap();
  await page.locator('.actionmenu__button').waitFor();
  assert.equal(await page.getByRole('menu').count(), 0, 'Menu leaked onto the next screen');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.nav__item').first().tap();
  await page.locator('.swipe').first().waitFor();
  // A real iOS swipe can have no trailing click. Dispatch that exact sequence,
  // then use an actual touchscreen tap to verify it is not swallowed.
  const row = page.locator('.swipe').first();
  for (const [event, x] of [['pointerdown', 180], ['pointermove', 215], ['pointerup', 215]]) {
    await row.dispatchEvent(event, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: 350, bubbles: true });
  }
  await row.locator('.entry__open').tap();
  await page.waitForFunction(() => location.hash.startsWith('#/entry/'));
  await page.locator('.sectionrail__chip').first().waitFor();
  await page.locator('.nav__item').first().tap();
  await page.evaluate(firstHash => { location.hash = firstHash; }, firstHash);
  await page.locator('.sectionrail__chip').first().waitFor();
  assert.deepEqual(errors, []);
  console.log('Mobile taps passed: project creation, Save → New, repeated New, draft preservation, all 11 sections in Hebrew/English, short-screen menu, menu cleanup on navigation, and first tap after a swipe without a click.');
} finally {
  await context.close();
  await browser.close();
}
