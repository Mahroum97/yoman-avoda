/** Disposable desktop document-workspace checks. Never opens an installed diary profile. */
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

async function contextFor({ width, height, language = 'en', theme = 'light', desktop = false }) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(({ language, theme, desktop }) => {
    localStorage.setItem('yoman-lang', language);
    localStorage.setItem('yoman-theme', theme);
    window.__saveAttempts = [];
    window.__shareAttempts = [];
    window.__cancelSave = false;
    window.__cancelShare = false;
    if (desktop) {
      window.yoman = {
        platform: 'darwin',
        version: 'desktop-document-qa',
        saveFile: async (name, bytes) => {
          const saved = !window.__cancelSave;
          window.__saveAttempts.push({ name, bytes: bytes.length, saved });
          return { saved };
        },
        shareFile: async (name, bytes) => {
          const shared = !window.__cancelShare;
          window.__shareAttempts.push({ name, bytes: bytes.length, shared });
          return { shared };
        },
        autoBackup: async () => ({ saved: false }),
        sync: {
          status: async () => ({ running: false }),
          newCode: async () => ({ running: false }),
          start: async () => ({ running: false }),
          stop: async () => ({ running: false }),
          onRequest: () => {},
        },
      };
    }
  }, { language, theme, desktop });
  return context;
}

async function seed(page) {
  await page.goto(base);
  return page.evaluate(async () => {
    const { db, blankEntry, ACTIVE_PROJECT_KEY } = await import('/src/db.ts');
    const now = Date.now();
    const alphaId = await db.projects.add({
      uid: 'desktop-alpha',
      name: 'מגדל השחר · ALPHA',
      address: 'רחוב הבדיקה 12',
      company: 'חברת בדיקות בע״מ',
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const betaId = await db.projects.add({
      uid: 'desktop-beta',
      name: 'BETA PROJECT',
      address: 'Other synthetic site',
      company: 'Beta QA',
      archived: false,
      createdAt: now + 1,
      updatedAt: now + 1,
    });

    const full = blankEntry(alphaId, '2026-09-13', 'desktop-alpha');
    const currentId = await db.entries.add({
      ...full,
      uid: 'desktop-alpha-current',
      weather: 'בהיר · Clear',
      management: Array.from({ length: 4 }, (_, i) => ({
        id: `manager-${i}`,
        name: ['אחמד חטאבה', 'נועה כהן', 'יוסף לוי', 'מירה נאסר'][i],
        role: ['מנהל עבודה', 'מהנדסת', 'מפקח', 'בטיחות'][i],
      })),
      contractors: Array.from({ length: 12 }, (_, i) => ({
        id: `contractor-${i}`,
        trade: ['חשמל', 'אינסטלציה', 'טפסנות', 'ברזלנות', 'איטום', 'ריצוף'][i % 6],
        workers: String((i % 5) + 1),
      })),
      equipment: [
        { id: 'equipment-1', kind: 'עגורן', qty: '1', hours: '8' },
        { id: 'equipment-2', kind: 'מחפרון', qty: '2', hours: '5' },
      ],
      workDescription: 'יציקת קירות קומה 4\nהשלמת תשתיות חשמל ואינסטלציה\nבדיקת איטום במרפסות',
      casting: {
        description: 'קירות ועמודים', sizeQty: '85 מ״ק', pump: 'משאבה 42 מ׳',
        concreteType: 'ב-40', concreteQty: '85', notes: 'בדיקת שקיעה תקינה',
        notesConcreteType: 'חשיפה 3',
      },
      supervisorNotes: 'יש להשלים מעקות זמניים לפני תחילת העבודה מחר.\nהשטח נבדק ונמצא מסודר.',
      receivedToday: 'ברזל 12 טון · בלוקים 8 משטחים · צנרת חשמל',
      status: 'draft',
    });

    const signedId = await db.entries.add({
      ...blankEntry(alphaId, '2026-09-12', 'desktop-alpha'),
      uid: 'desktop-alpha-signed',
      weather: 'מעונן',
      workDescription: 'SIGNED ALPHA PAGE',
      status: 'signed',
    });
    const conflictId = await db.entries.add({
      ...blankEntry(alphaId, '2026-09-11', 'desktop-alpha'),
      uid: 'desktop-alpha-conflict',
      workDescription: 'CONFLICT ALPHA PAGE',
      syncConflict: true,
      syncConflictKind: 'deletion',
      syncConflictGroup: 'deletion:desktop-alpha-conflict',
      syncConflictRoot: 'desktop-alpha-conflict',
    });
    await db.entries.add({
      ...blankEntry(alphaId, '2026-09-10', 'desktop-alpha'),
      uid: 'desktop-alpha-deleted',
      workDescription: 'DELETED ALPHA PAGE',
      deletedAt: now,
    });
    const augustId = await db.entries.add({
      ...blankEntry(alphaId, '2026-08-31', 'desktop-alpha'),
      uid: 'desktop-alpha-august',
      workDescription: 'AUGUST ALPHA PAGE',
    });
    const betaEntryId = await db.entries.add({
      ...blankEntry(betaId, '2026-09-13', 'desktop-beta'),
      uid: 'desktop-beta-current',
      workDescription: 'BETA ONLY PAGE',
    });
    await db.settings.put({ key: ACTIVE_PROJECT_KEY, value: alphaId });
    location.hash = '/';
    return { alphaId, betaId, currentId, signedId, conflictId, augustId, betaEntryId };
  });
}

async function geometry(page, direction) {
  const workspace = page.locator('.desktop-diary');
  await workspace.waitFor();
  const [days, document, inspector, sheet, frame] = await Promise.all([
    page.locator('.desktop-days').boundingBox(),
    page.locator('.desktop-document').boundingBox(),
    page.locator('.desktop-inspector').boundingBox(),
    page.locator('.desktop-document .sheet').first().boundingBox(),
    page.locator('.desktop-document .sheet-frame').boundingBox(),
  ]);
  assert(days && document && inspector && sheet && frame, 'Desktop workspace geometry is incomplete');
  if (direction === 'ltr') {
    assert(days.x < document.x && document.x < inspector.x, 'LTR pane order is not rail / document / inspector');
    assert(days.x + days.width <= document.x + 1, 'LTR day rail overlaps the document');
    assert(document.x + document.width <= inspector.x + 1, 'LTR inspector overlaps the document');
  } else {
    assert(inspector.x < document.x && document.x < days.x, 'RTL pane order is not inspector / document / rail');
    assert(inspector.x + inspector.width <= document.x + 1, 'RTL inspector overlaps the document');
    assert(document.x + document.width <= days.x + 1, 'RTL day rail overlaps the document');
  }
  assert(sheet.x >= document.x - 1 && sheet.x + sheet.width <= document.x + document.width + 1,
    `A4 sheet escapes the centre pane: ${JSON.stringify({ sheet, document, frame })}`);
  assert(frame.width <= document.width, 'A4 clipping frame widens the centre pane');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Desktop workspace causes horizontal page overflow');
  assert.equal(await page.locator('.desktop-document .sheet').count(), 1,
    'The daily workspace must render one shared A4 diary sheet');
}

async function waitForAttempt(page, kind, count) {
  await page.waitForFunction(({ kind, count }) => window[kind].length >= count, { kind, count });
}

try {
  await mkdir('tmp', { recursive: true });

  // Electron's default-sized English window exercises real export and share delivery.
  const desktop = await contextFor({ width: 1180, height: 860, language: 'en', desktop: true });
  const page = await desktop.newPage();
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const ids = await seed(page);
  await page.locator('.desktop-document .sheet').waitFor();
  await geometry(page, 'ltr');
  assert.equal(await page.locator('.desktop-days__item').count(), 3, 'Deleted or wrong-month pages leaked into the rail');
  assert.equal(await page.locator('.desktop-days__item[aria-pressed="true"]').count(), 1);
  assert((await page.locator('.desktop-document .sheet').textContent()).includes('יציקת קירות קומה 4'));
  assert.equal(await page.locator('.desktop-document .sheet__band-sub').first().textContent(), 'מגדל השחר · ALPHA');
  assert.equal(await page.locator('.desktop-inspector__formats [aria-pressed="true"]').textContent(), 'PDF');
  assert.equal(await page.locator('.desktop-days__status--signed').count(), 1);
  assert.equal(await page.locator('.desktop-days__status--conflict').count(), 1);

  // Month navigation stays bounded, selects its newest day and can return.
  await page.locator('.desktop-days__month-input').fill('2026-08');
  await page.waitForFunction(() => document.querySelectorAll('.desktop-days__item').length === 1);
  await page.locator('.desktop-document .sheet').getByText('AUGUST ALPHA PAGE', { exact: true }).waitFor();
  await page.locator('.desktop-days__month-input').fill('2026-09');
  await page.waitForFunction(() => document.querySelectorAll('.desktop-days__item').length === 3);
  await page.locator('.desktop-days__item').nth(1).click();
  await page.waitForFunction(id => location.hash === `#/preview/${id}`, ids.signedId);
  await page.waitForFunction(() =>
    document.querySelector('.desktop-days__item[aria-pressed="true"] .desktop-days__number')?.textContent === '12');
  assert.equal(await page.locator('.desktop-days__item[aria-pressed="true"] .desktop-days__number').textContent(), '12');
  await page.locator('.desktop-document .sheet').getByText('SIGNED ALPHA PAGE', { exact: true }).waitFor();
  await page.evaluate(id => { location.hash = `/preview/${id}`; }, ids.currentId);
  await page.locator('.desktop-document .sheet').getByText('יציקת קירות קומה 4', { exact: true }).waitFor();

  // Save cancellation is quiet; each selected format then reaches the native bridge.
  await page.evaluate(() => { window.__cancelSave = true; });
  await page.locator('.desktop-inspector__save').click();
  await waitForAttempt(page, '__saveAttempts', 1);
  await page.locator('.desktop-inspector__save:not([disabled])').waitFor();
  assert.equal(await page.locator('.toast').count(), 0, 'Cancelled save announced a created file');

  await page.evaluate(() => { window.__cancelSave = false; });
  await page.locator('.desktop-inspector__save').click();
  await waitForAttempt(page, '__saveAttempts', 2);
  await page.locator('.desktop-inspector__format').filter({ hasText: 'Word' }).click();
  await page.locator('.desktop-inspector__save').click();
  await waitForAttempt(page, '__saveAttempts', 3);
  await page.locator('.desktop-inspector__format').filter({ hasText: 'Image' }).click();
  await page.locator('.desktop-inspector__save').click();
  await waitForAttempt(page, '__saveAttempts', 4);
  const saves = await page.evaluate(() => window.__saveAttempts);
  assert(saves[1].saved && saves[1].name.endsWith('.pdf') && saves[1].bytes > 1000);
  assert(saves[2].saved && saves[2].name.endsWith('.docx') && saves[2].bytes > 1000);
  assert(saves[3].saved && saves[3].name.endsWith('.jpg') && saves[3].bytes > 1000);

  await page.locator('.desktop-inspector__format').filter({ hasText: 'PDF' }).click();
  await page.locator('.desktop-inspector__deliver').click();
  await waitForAttempt(page, '__shareAttempts', 1);
  const shares = await page.evaluate(() => window.__shareAttempts);
  assert(shares[0].shared && shares[0].name.endsWith('.pdf') && shares[0].bytes > 1000);

  // Conflict detection must follow a causal group across changed dates and
  // also catch two unflagged live rows that independently claimed one date.
  const grouped = await page.evaluate(async alphaId => {
    const { db, blankEntry } = await import('/src/db.ts');
    const firstId = await db.entries.add({
      ...blankEntry(alphaId, '2026-10-01', 'desktop-alpha'),
      uid: 'desktop-cross-date-a',
      syncConflict: true,
      syncConflictGroup: 'revision:desktop-cross-date',
      syncConflictRoot: 'desktop-cross-date',
      workDescription: 'CROSS DATE A',
    });
    await db.entries.add({
      ...blankEntry(alphaId, '2026-10-02', 'desktop-alpha'),
      uid: 'desktop-cross-date-b',
      syncConflict: true,
      syncConflictGroup: 'revision:desktop-cross-date',
      syncConflictRoot: 'desktop-cross-date',
      workDescription: 'CROSS DATE B',
    });
    const duplicateId = await db.entries.add({
      ...blankEntry(alphaId, '2026-11-03', 'desktop-alpha'),
      uid: 'desktop-same-date-a',
      workDescription: 'SAME DATE A',
    });
    await db.entries.add({
      ...blankEntry(alphaId, '2026-11-03', 'desktop-alpha'),
      uid: 'desktop-same-date-b',
      workDescription: 'SAME DATE B',
    });
    return { firstId, duplicateId };
  }, ids.alphaId);
  for (const id of [grouped.firstId, grouped.duplicateId]) {
    await page.evaluate(id => { location.hash = `/preview/${id}`; }, id);
    await page.waitForFunction(id => location.hash === `#/preview/${id}`, id);
    await page.locator('.desktop-document__notice[role="alert"]').waitFor();
    assert(await page.locator('.desktop-inspector__deliver').isDisabled());
    assert(await page.locator('.desktop-inspector__save').isDisabled());
  }

  // A routed page keeps its owning project even if another project is active.
  await page.evaluate(async ({ betaId, currentId }) => {
    const { db, ACTIVE_PROJECT_KEY } = await import('/src/db.ts');
    await db.settings.put({ key: ACTIVE_PROJECT_KEY, value: betaId });
    location.hash = `/preview/${currentId}`;
  }, ids);
  await page.waitForFunction(id => location.hash === `#/preview/${id}`, ids.currentId);
  await page.locator('.desktop-document .sheet__band-sub').filter({ hasText: 'מגדל השחר · ALPHA' }).waitFor();
  assert(!(await page.locator('.desktop-diary').textContent()).includes('BETA ONLY PAGE'));
  await page.locator('.desktop-document__edit').click();
  await page.waitForFunction(id => location.hash === `#/entry/${id}`, ids.currentId);
  await page.evaluate(id => { location.hash = `/preview/${id}`; }, ids.conflictId);

  // A deletion conflict remains visible but cannot reach either delivery bridge.
  await page.locator('.desktop-document__notice[role="alert"]').waitFor();
  assert(await page.locator('.desktop-inspector__deliver').isDisabled());
  assert(await page.locator('.desktop-inspector__save').isDisabled());
  assert.equal(await page.evaluate(() => window.__saveAttempts.length), 4);
  assert.equal(await page.evaluate(() => window.__shareAttempts.length), 1);
  await page.locator('.desktop-inspector__reports-button').click();
  await page.waitForFunction(() => location.hash === '#/reports');

  // The explicit list route retains the established diary list on a wide screen.
  await page.evaluate(async id => {
    const { db, ACTIVE_PROJECT_KEY } = await import('/src/db.ts');
    await db.settings.put({ key: ACTIVE_PROJECT_KEY, value: id });
    location.hash = '/?view=list';
  }, ids.alphaId);
  await page.waitForFunction(() => location.hash === '#/?view=list');
  await page.locator('.list').first().waitFor();
  assert.equal(await page.locator('.desktop-diary').count(), 0);
  assert.deepEqual(errors, []);
  await desktop.close();

  // Exact breakpoint and all writing directions use the same three-pane web workspace.
  for (const language of ['en', 'he', 'ar']) {
    const context = await contextFor({ width: language === 'en' ? 1100 : 1320, height: 900, language,
      theme: language === 'he' ? 'dark' : 'light' });
    const slice = await context.newPage();
    slice.setDefaultTimeout(30_000);
    const sliceErrors = [];
    slice.on('pageerror', error => sliceErrors.push(error.message));
    await seed(slice);
    await slice.locator('.desktop-document .sheet').waitFor();
    await geometry(slice, language === 'en' ? 'ltr' : 'rtl');
    assert.equal(await slice.locator('html').getAttribute('dir'), language === 'en' ? 'ltr' : 'rtl');
    assert.equal(await slice.locator('.desktop-days__number[dir="ltr"]').count(), 3);
    if (language === 'he') {
      await slice.screenshot({ path: 'tmp/desktop-document-he-dark.png', fullPage: true });
      await slice.screenshot({ path: 'tmp/desktop-document-he-dark-viewport.png', fullPage: false });
      await slice.setViewportSize({ width: 1180, height: 860 });
      await slice.screenshot({ path: 'tmp/desktop-document-default-1180.png', fullPage: true });
      await geometry(slice, 'rtl');
    }
    assert.deepEqual(sliceErrors, []);
    await context.close();
  }

  // A project with no current-month page opens the month of its latest page.
  const older = await contextFor({ width: 1100, height: 800, language: 'en' });
  const olderPage = await older.newPage();
  await olderPage.goto(base);
  await olderPage.evaluate(async () => {
    const { db, blankEntry, ACTIVE_PROJECT_KEY } = await import('/src/db.ts');
    const now = Date.now();
    const projectId = await db.projects.add({
      uid: 'desktop-older-project', name: 'Older Project', address: '', company: 'QA',
      archived: false, createdAt: now, updatedAt: now,
    });
    await db.entries.add({
      ...blankEntry(projectId, '2026-07-04', 'desktop-older-project'),
      uid: 'desktop-older-page', workDescription: 'LATEST OLDER PAGE',
    });
    await db.settings.put({ key: ACTIVE_PROJECT_KEY, value: projectId });
    location.hash = '/';
  });
  await olderPage.locator('.desktop-document .sheet').getByText('LATEST OLDER PAGE', { exact: true }).waitFor();
  assert.equal(await olderPage.locator('.desktop-days__month-input').inputValue(), '2026-07');
  await older.close();

  // One pixel below the breakpoint keeps the existing compact/mobile diary UI.
  const narrow = await contextFor({ width: 1099, height: 860, language: 'en' });
  const narrowPage = await narrow.newPage();
  await seed(narrowPage);
  await narrowPage.locator('.list').first().waitFor();
  assert.equal(await narrowPage.locator('.desktop-diary').count(), 0);
  assert.equal(await narrowPage.locator('.nav').evaluate(element => getComputedStyle(element).position), 'fixed');
  assert(await narrowPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await narrow.close();

  console.log('Desktop document checks passed: 1099/1100 breakpoints, web/Electron geometry, English/Hebrew/Arabic direction, month/day/fallback selection, real A4 preview, edit/reports/list navigation, owner-correct routes, PDF/Word/image save, share, cancellation and conflict blocking.');
} finally {
  await browser.close();
}
