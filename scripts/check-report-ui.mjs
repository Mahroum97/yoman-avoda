/** Fresh browser context and synthetic diary only; never uses an installed app profile. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.YOMAN_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.YOMAN_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('yoman-lang', 'en');
    window.__savedFiles = [];
    window.__sharedFiles = [];
    window.yoman = { platform: 'darwin', version: 'test', saveFile: async (name, bytes) => {
      window.__savedFiles.push({ name, bytes: Array.from(bytes) });
      return { saved: true };
    }, shareFile: async (name, bytes) => {
      window.__sharedFiles.push({ name, bytes: Array.from(bytes) });
      return { shared: true };
    } };
  });
  await page.goto(base);
  await page.evaluate(async () => {
    const { db, blankContact, blankEntry, ACTIVE_PROJECT_KEY } = await import('/src/db.ts');
    const { emptyCasting } = await import('/src/types.ts');
    const id = await db.projects.add({ uid: 'ui-project', name: 'QA site', company: 'QA', address: 'Test', archived: false, createdAt: 1, updatedAt: 1 });
    await db.settings.put({ key: ACTIVE_PROJECT_KEY, value: id });
    await db.contacts.add({
      ...blankContact(),
      uid: 'ui-contractor',
      name: 'QA Named Contractor',
      trade: 'Carpentry',
      phone: '050-111-2222',
    });
    await db.entries.add({ uid: 'ui-day', projectUid: 'ui-project', projectId: id, date: '2026-09-01',
      weather: '', management: [], contractors: [
        { id: 'a', contractorUid: 'ui-contractor', contractorName: 'QA Named Contractor', trade: 'Carpentry', workers: '3' },
        { id: 'b', trade: 'Electrical', workers: '88' },
      ],
      equipment: [{ id: 'e', kind: 'PRIVATE-EQUIPMENT', qty: '1', hours: '9' }], casting: emptyCasting(), workDescription: 'PRIVATE-DESCRIPTION', supervisorNotes: '',
      managerSignature: '', supervisorSignature: '', status: 'draft', photos: [], createdAt: 1, updatedAt: 1,
      deliveryLedger: { version: 1, reviewed: true, rows: [
        { id: 'concrete-delivery', material: 'concrete', quantity: '5.125', unit: 'm3', supplierName: 'QA Concrete Supplier', deliveryNote: 'QA-CON-001', specification: 'C30', location: 'Slab 2', notes: 'Concrete source note' },
        { id: 'steel-delivery', material: 'steel', quantity: '1.25', unit: 'tonne', supplierName: 'QA Steel Supplier', deliveryNote: 'QA-ST-001', specification: 'B500', location: 'Building A', notes: 'Steel source note' },
      ] },
    });
    await db.entries.add({
      ...blankEntry(id, '2026-09-02', 'ui-project'),
      uid: 'ui-day-two',
    });
    location.hash = '/reports';
  });
  const picker = page.getByRole('combobox', { name: 'Period summary', exact: true });
  await picker.waitFor();
  const summaryCard = page.locator('section.card').filter({ has: picker });
  await page.getByLabel('From', { exact: true }).fill('2026-09-01');
  await page.getByLabel('To', { exact: true }).fill('2026-09-30');
  await picker.selectOption('trades');
  await summaryCard.getByRole('button', { name: 'Create PDF', exact: true }).click();
  await page.waitForFunction(() => window.__savedFiles.length === 1);
  const saved = await page.evaluate(() => window.__savedFiles[0]);
  assert(saved.name.includes('Workers by trade'));
  await writeFile('tmp/check-ui-summary.pdf', Buffer.from(saved.bytes));
  const text = execFileSync('pdftotext', ['tmp/check-ui-summary.pdf', '-'], { encoding: 'utf8' });
  assert(text.includes('Carpentry') && text.includes('Electrical'));
  assert(text.includes('Total: 91 workers'));
  assert(!text.includes('PRIVATE-'));

  // Start at the real Reports screen and reach every promised quantity report
  // through both file buttons. The generators already have focused tests; this
  // proves concrete, steel and a stable named contractor are actually wired to
  // user-visible controls carrying the selected range.
  const quantityCard = page.locator('section.card').filter({
    has: page.getByRole('heading', { name: 'Quantity and contractor reports', exact: true }),
  });
  await quantityCard.waitFor();
  const quantityPicker = quantityCard.getByRole('combobox', { name: 'List to export', exact: true });
  const exportQuantity = async (choice, button) => {
    await quantityPicker.selectOption(choice);
    const before = await page.evaluate(() => window.__savedFiles.length);
    await quantityCard.getByRole('button', { name: button, exact: true }).click();
    await page.waitForFunction(count => window.__savedFiles.length === count + 1, before);
    return page.evaluate(() => window.__savedFiles.at(-1));
  };

  const quantityExports = [];
  for (const choice of ['concrete', 'steel', 'contractor:ui-contractor']) {
    quantityExports.push(await exportQuantity(choice, 'Create PDF'));
    quantityExports.push(await exportQuantity(choice, 'Export to Excel'));
  }

  const expected = [
    ['Concrete received on site', '5.125', 'QA-CON-001'],
    ['Concrete received on site', '5.125', 'QA-CON-001'],
    ['Steel received on site', '1250', 'QA-ST-001'],
    ['Steel received on site', '1250', 'QA-ST-001'],
    ['QA Named Contractor', '3', 'Carpentry'],
    ['QA Named Contractor', '3', 'Carpentry'],
  ];
  for (let index = 0; index < quantityExports.length; index += 1) {
    const savedQuantity = quantityExports[index];
    const bytes = Buffer.from(savedQuantity.bytes);
    assert(savedQuantity.name.includes('2026-09-01-2026-09-30'));
    if (savedQuantity.name.endsWith('.pdf')) {
      const path = `tmp/check-ui-quantity-${index}.pdf`;
      await writeFile(path, bytes);
      const output = execFileSync('pdftotext', [path, '-'], { encoding: 'utf8' });
      for (const needle of expected[index]) assert(output.includes(needle), `${savedQuantity.name} omitted ${needle}`);
      assert(!output.includes('PRIVATE-DESCRIPTION') && !output.includes('OTHER PROJECT'));
    } else {
      const zip = await JSZip.loadAsync(bytes);
      const xml = (await Promise.all(
        Object.values(zip.files)
          .filter(file => file.name.startsWith('xl/worksheets/') && !file.dir)
          .map(file => file.async('string')),
      )).join('\n');
      for (const needle of expected[index]) assert(xml.includes(needle), `${savedQuantity.name} omitted ${needle}`);
      assert(!xml.includes('PRIVATE-DESCRIPTION') && !xml.includes('OTHER PROJECT'));
    }
  }

  await quantityPicker.selectOption('contractor:ui-contractor');
  await quantityCard.getByRole('button', { name: 'Share', exact: true }).click();
  await page.waitForFunction(() => window.__sharedFiles.length === 1);
  const shared = await page.evaluate(() => window.__sharedFiles[0]);
  assert(shared.name.includes('QA Named Contractor') && shared.name.endsWith('.pdf'));

  // A range without a summary has globally knowable page numbers. When the
  // PDF-only summary is included, the HTML preview leaves the number blank
  // instead of restarting every day at a false "1 of N".
  await page.evaluate(() => {
    location.hash = '/report-preview?from=2026-09-01&to=2026-09-30&photos=0&summary=0';
  });
  await page.locator('.sheet').nth(1).waitFor();
  assert.deepEqual(await page.locator('.sheet__band-page').allTextContents(), ['Page 1 of 2', 'Page 2 of 2']);
  await page.evaluate(() => {
    location.hash = '/report-preview?from=2026-09-01&to=2026-09-30&photos=0&summary=1';
  });
  await page.waitForFunction(() => document.querySelectorAll('.sheet').length === 2);
  assert.deepEqual(await page.locator('.sheet__band-page').allTextContents(), ['', '']);
  await page.evaluate(() => { location.hash = '/reports'; });
  await picker.waitFor();

  // Live reports must update when sync/store changes occur on the open screen.
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    const row = await db.entries.where('uid').equals('ui-day').first();
    await db.entries.update(row.id, { contractors: [], equipment: [{ id: 'e', kind: 'Excavator', qty: '1', hours: '7' }] });
  });
  await page.waitForFunction(() => {
    const card = [...document.querySelectorAll('section.card')]
      .find(section => section.querySelector('h2')?.textContent === 'Share a separate summary');
    return card?.querySelector('button')?.disabled;
  });
  await picker.selectOption('equipment');
  await summaryCard.getByRole('button', { name: 'Create PDF', exact: true }).waitFor({ state: 'visible' });
  assert(!(await summaryCard.getByRole('button', { name: 'Create PDF', exact: true }).isDisabled()));

  await page.getByLabel('From', { exact: true }).fill('2026-10-01');
  await page.getByLabel('To', { exact: true }).fill('2026-10-31');
  await page.waitForFunction(() => !document.querySelector('select'));
  assert(await page.getByRole('button', { name: /Create PDF report/ }).isDisabled());
  await page.getByLabel('From', { exact: true }).fill('2026-09-01');
  await page.getByLabel('To', { exact: true }).fill('2026-09-30');
  await picker.waitFor();

  // Sync can preserve two real versions of one day. Reports must refuse to
  // choose or double-count them until one is deliberately moved to Trash.
  const conflictId = await page.evaluate(async () => {
    const { db, blankEntry } = await import('/src/db.ts');
    const original = await db.entries.where('uid').equals('ui-day').first();
    await db.entries.update(original.id, { syncConflict: true });
    return db.entries.add({
      ...blankEntry(original.projectId, original.date, original.projectUid),
      uid: 'ui-day-conflicting-copy',
      syncConflict: true,
    });
  });
  await page.locator('.report-conflict').waitFor();
  assert.equal(await page.locator('section.card').filter({
    has: page.getByRole('heading', { name: 'Share a separate summary', exact: true }),
  }).count(), 0);
  assert.equal(await page.locator('section.card').filter({
    has: page.getByRole('heading', { name: 'Quantity and contractor reports', exact: true }),
  }).count(), 0);
  assert(await page.getByRole('button', { name: /Create PDF report/ }).isDisabled());

  await page.evaluate(() => {
    location.hash = '/report-preview?from=2026-09-01&to=2026-09-30&photos=0&summary=0';
  });
  await page.locator('.report-conflict').waitFor();
  assert.equal(await page.locator('.sheet').count(), 0);
  assert(await page.getByRole('button', { name: 'Create PDF', exact: true }).isDisabled());

  await page.evaluate(async (id) => {
    const { deleteEntry } = await import('/src/db.ts');
    await deleteEntry(id);
    location.hash = '/reports';
  }, conflictId);
  await picker.waitFor();
  await quantityCard.waitFor();
  assert.equal(await page.locator('.report-conflict').count(), 0);

  // A checked editor can preserve the stored and visible revisions after the
  // visible draft changed date. Their group, rather than date equality, keeps
  // both alternatives out of reports until one is reviewed and removed.
  const groupedConflictId = await page.evaluate(async () => {
    const { db, blankEntry } = await import('/src/db.ts');
    const project = await db.projects.where('uid').equals('ui-project').first();
    const group = 'revision:cross-date-ui-test';
    await db.entries.add({
      ...blankEntry(project.id, '2026-09-03', project.uid),
      uid: 'ui-cross-date-a', syncConflict: true, syncConflictGroup: group,
    });
    return db.entries.add({
      ...blankEntry(project.id, '2026-09-04', project.uid),
      uid: 'ui-cross-date-b', syncConflict: true, syncConflictGroup: group,
    });
  });
  await page.locator('.report-conflict').waitFor();
  const blockedDates = await page.locator('.report-conflict__dates').textContent();
  assert(blockedDates.includes('03/09/2026') && blockedDates.includes('04/09/2026'));
  await page.evaluate(async (id) => {
    const { deleteEntry } = await import('/src/db.ts');
    await deleteEntry(id);
  }, groupedConflictId);
  await page.locator('.report-conflict').waitFor({ state: 'detached' });
  await quantityCard.waitFor();

  // A permanent deletion racing an offline edit has one recoverable live row,
  // not two. Its explicit kind must still block every report until Save keeps
  // it or Trash confirms the deletion.
  const deletionConflictId = await page.evaluate(async () => {
    const { db, blankEntry } = await import('/src/db.ts');
    const project = await db.projects.where('uid').equals('ui-project').first();
    return db.entries.add({
      ...blankEntry(project.id, '2026-09-05', project.uid),
      uid: 'ui-delete-edit-conflict',
      syncConflict: true,
      syncConflictKind: 'deletion',
      syncConflictGroup: 'deletion:ui-delete-edit-conflict',
      syncConflictRoot: 'ui-delete-edit-conflict',
    });
  });
  await page.locator('.report-conflict').waitFor();
  await page.getByRole('heading', { name: 'Sync conflict · deletion needs review', exact: true }).waitFor();
  assert((await page.locator('.report-conflict__dates').textContent()).includes('05/09/2026'));
  assert.equal(await quantityCard.count(), 0);
  await page.evaluate(() => {
    location.hash = '/report-preview?from=2026-09-01&to=2026-09-30&photos=0&summary=0';
  });
  await page.getByRole('heading', { name: 'Sync conflict · deletion needs review', exact: true }).waitFor();
  assert.equal(await page.locator('.sheet').count(), 0);
  await page.evaluate(async (id) => {
    const { deleteEntry } = await import('/src/db.ts');
    await deleteEntry(id);
    location.hash = '/reports';
  }, deletionConflictId);
  await picker.waitFor();
  await page.locator('.report-conflict').waitFor({ state: 'detached' });
  await quantityCard.waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const { applyLanguage } = await import('/src/i18n/useLanguage.ts');
    localStorage.setItem('yoman-lang', 'he');
    applyLanguage('he');
    window.dispatchEvent(new Event('yoman-language'));
  });
  await page.getByRole('heading', { name: 'סיכום נפרד לשליחה' }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'tmp/check-reports-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Report browser checks passed: scoped summary PDF, concrete/steel/named-contractor PDF and Excel plus share reachability, truthful preview numbering, live updates, revision and deletion conflict blocking/resolution, changed period, Hebrew mobile layout.');
} finally {
  await browser.close();
}
