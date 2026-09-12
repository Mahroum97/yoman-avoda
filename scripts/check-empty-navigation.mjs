/**
 * Empty-install navigation regression, using fresh synthetic browser storage.
 * This exercises real touchscreen events in Chromium's iPhone viewport; native
 * WKWebView / simulator verification is separate. Run against the Vite server.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.YOMAN_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.YOMAN_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const destinations = [
  { path: '/', label: 'navDiary', heading: 'diaryTitle' },
  { path: '/reports', label: 'navReports', heading: 'reportsTitle' },
  { path: '/entry/new', label: 'navNew' },
];

async function labelsFor(page) {
  return page.evaluate(async () => {
    const { currentStrings } = await import('/src/i18n/useLanguage.ts');
    const strings = currentStrings();
    return Object.fromEntries([
      'navDiary', 'navReports', 'navNew', 'newProject', 'cancel', 'save',
      'labelProjectName', 'restoreInstead', 'settingsTitle', 'diaryTitle', 'reportsTitle',
    ].map(key => [key, strings[key]]));
  });
}

function navButton(page, labels, destination) {
  return page.locator('.nav').getByRole('button', { name: labels[destination.label], exact: true });
}

async function verifyEmptyDestination(page, labels, destination) {
  const button = navButton(page, labels, destination);
  assert.equal(await button.isEnabled(), true, `${destination.path} must respond before project setup`);
  await button.tap();
  await page.locator('.project-setup').waitFor();
  await page.getByRole('heading', { name: labels[destination.label], level: 1, exact: true }).waitFor();
  // Allow a redirect effect to run: a heading that flashes and disappears is
  // exactly the former bug and must not count as successful navigation.
  await page.waitForTimeout(100);
  assert.equal(new URL(page.url()).hash, `#${destination.path}`, 'Empty tab bounced to another screen');
  assert.equal(await button.getAttribute('aria-current'), 'page', 'Tapped tab is not selected');
  assert.equal(await page.locator('.project-setup').isVisible(), true);
  assert.equal(await page.locator('.project-setup').getByRole('button', {
    name: labels.newProject, exact: true,
  }).isVisible(), true, 'Project setup must offer a visible next action');
}

async function projectCount(page) {
  return page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    return db.projects.count();
  });
}

async function verifyReadyDestination(page, labels, destination) {
  await page.waitForFunction(path => location.hash === `#${path}`, destination.path);
  if (destination.heading) {
    await page.getByRole('heading', {
      name: labels[destination.heading], level: 1, exact: true,
    }).waitFor();
  } else {
    await page.locator('.sectionrail__chip').first().waitFor();
    await page.locator('#section-date').waitFor();
  }
  assert.equal(await page.locator('.project-setup').count(), 0, 'Setup gate remained after project creation');
}

try {
  for (const language of ['he', 'en']) {
    for (const destination of destinations) {
      const context = await browser.newContext({ ...devices['iPhone 14'] });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(language => {
        localStorage.setItem('yoman-lang', language);
        localStorage.setItem('yoman-theme', 'light');
      }, language);

      try {
        await page.goto(base);
        await page.locator('.project-setup').waitFor();
        const labels = await labelsFor(page);
        assert.equal(await projectCount(page), 0, 'Regression must begin with an empty install');

        // None of these taps may depend on a fixture project created beforehand.
        for (const emptyDestination of destinations) {
          await verifyEmptyDestination(page, labels, emptyDestination);
        }

        await verifyEmptyDestination(page, labels, destination);
        await page.locator('.project-setup').getByRole('button', {
          name: labels.restoreInstead, exact: true,
        }).tap();
        await page.getByRole('heading', { name: labels.settingsTitle, level: 1, exact: true }).waitFor();
        assert.equal(new URL(page.url()).hash, '#/settings', 'Restore settings became unreachable while empty');

        await verifyEmptyDestination(page, labels, destination);
        const startCreation = async () => {
          await page.locator('.project-setup').getByRole('button', {
            name: labels.newProject, exact: true,
          }).tap();
          const dialog = page.getByRole('dialog');
          await dialog.waitFor();
          return dialog;
        };

        const cancelled = await startCreation();
        await cancelled.getByRole('button', { name: labels.cancel, exact: true }).tap();
        await cancelled.waitFor({ state: 'hidden' });
        assert.equal(await projectCount(page), 0, 'Cancelling setup created a project');

        await verifyEmptyDestination(page, labels, destination);
        const dialog = await startCreation();
        const projectName = `Empty navigation QA ${language} ${destination.label}`;
        await dialog.getByLabel(labels.labelProjectName, { exact: true }).fill(projectName);
        await dialog.getByRole('button', { name: labels.save, exact: true }).tap();
        await dialog.waitFor({ state: 'hidden' });
        await verifyReadyDestination(page, labels, destination);
        assert.equal(await projectCount(page), 1, 'Setup must create exactly one project');
        assert.equal(await page.locator('.topbar__title').textContent(), projectName, 'Created project is not active');

        for (const readyDestination of destinations) {
          await navButton(page, labels, readyDestination).tap();
          await verifyReadyDestination(page, labels, readyDestination);
        }
        assert.deepEqual(errors, [], 'Navigation emitted an uncaught application error');
        console.log(`PASS ${language} ${destination.path}: empty tabs, restore, cancellation, setup continuation, active tabs`);
      } catch (error) {
        console.error(`FAIL ${language} ${destination.path} at ${page.url()}`);
        throw error;
      } finally {
        await context.close();
      }
    }
  }
  console.log('Empty-install navigation passed in Hebrew and English with fresh storage for every creation destination.');
} finally {
  await browser.close();
}
