/** New disposable browser context + synthetic data only; never an installed diary profile. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.YOMAN_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.YOMAN_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
  await page.addInitScript(() => {
    localStorage.setItem('yoman-lang', 'en');
    localStorage.setItem('yoman-theme', 'light');
  });
  await page.goto(base);
  await page.waitForLoadState('networkidle');
  const seed = await page.evaluate(async () => {
    const { db, blankEntry, blankContact, ACTIVE_PROJECT_KEY } = await import('/src/db.ts');
    const now = Date.now();
    const projectA = { uid: 'quantity-ui-project-a', name: 'Quantity QA A', company: 'QA', address: 'Synthetic only', archived: false, createdAt: now, updatedAt: now };
    const projectB = { ...projectA, uid: 'quantity-ui-project-b', name: 'Quantity QA B' };
    const projectAId = await db.projects.add(projectA);
    const projectBId = await db.projects.add(projectB);
    await db.contacts.bulkAdd([
      { ...blankContact(), uid: 'quantity-contact-a', name: 'Same Contractor', trade: 'Carpentry', phone: '050-000-0001' },
      { ...blankContact(), uid: 'quantity-contact-b', name: 'Same Contractor', trade: 'Steel', phone: '050-000-0002' },
    ]);
    const entryAId = await db.entries.add({ ...blankEntry(projectAId, '2026-09-01', projectA.uid), uid: 'quantity-ui-day-a' });
    const entryB = {
      ...blankEntry(projectBId, '2026-09-01', projectB.uid), uid: 'quantity-ui-day-b',
      contractors: [{ id: 'other-crew', contractorUid: 'quantity-contact-b', contractorName: 'OTHER PROJECT CONTRACTOR', trade: 'OTHER PROJECT TRADE', workers: '99' }],
      deliveryLedger: { version: 1, reviewed: true, rows: [{ id: 'other-delivery', material: 'concrete', quantity: '999', unit: 'm3', supplierName: 'OTHER PROJECT SUPPLIER', deliveryNote: 'OTHER-PROJECT-NOTE', specification: 'C40', location: '', notes: '' }] },
    };
    const entryBId = await db.entries.add(entryB);
    await db.settings.put({ key: ACTIVE_PROJECT_KEY, value: projectAId });
    location.hash = `/entry/${entryAId}`;
    return { projectAId, projectBId, entryAId, entryBId, beforeB: JSON.stringify({ contractors: entryB.contractors, deliveryLedger: entryB.deliveryLedger }) };
  });

  const openSection = async selector => {
    const toggle = page.locator(selector);
    await toggle.waitFor();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  };
  const openContractors = () => openSection('#section-contractors > .card__toggle');
  const openDeliveries = async () => {
    const toggle = page.locator('.card__toggle').filter({ hasText: 'Delivery notes — concrete and steel' });
    await toggle.waitFor();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await page.locator('.quantity-ledger').waitFor();
  };
  const leaveAndWaitFor = async section => {
    await page.evaluate(() => { location.hash = '/entries'; });
    await page.waitForFunction(async expectedSection => {
      const { db } = await import('/src/db.ts');
      const entry = await db.entries.where('uid').equals('quantity-ui-day-a').first();
      return expectedSection === 'contractors'
        ? entry?.contractors.length === 3 && entry.contractors[2].workers === '4' && !!entry.contractors[2].contractorUid
        : entry?.deliveryLedger?.reviewed === true && entry.deliveryLedger.rows.length === 2 && entry.deliveryLedger.rows[1].quantity === '1.25';
    }, section);
  };
  const reopenA = async () => {
    await page.reload();
    await page.evaluate(id => { location.hash = `/entry/${id}`; }, seed.entryAId);
    await page.locator('#section-contractors').waitFor();
  };

  await openContractors();
  const contractors = page.locator('.contractor-editor');
  await contractors.getByRole('button', { name: 'Add contractor', exact: true }).click();
  const crew = index => contractors.locator('.row-item').nth(index);
  const firstPicker = crew(0).getByRole('combobox', { name: 'Contractor / company name', exact: true });
  const optionNames = await firstPicker.locator('option').allTextContents();
  assert(optionNames.some(value => value.includes('050-000-0001')));
  assert(optionNames.some(value => value.includes('050-000-0002')));
  await firstPicker.selectOption('quantity-contact-a');
  await crew(0).getByLabel('Trade', { exact: true }).fill('Carpentry');
  await crew(0).getByRole('textbox', { name: 'Workers', exact: true }).fill('3');

  await contractors.getByRole('button', { name: 'Add contractor', exact: true }).click();
  await crew(1).getByRole('combobox', { name: 'Contractor / company name', exact: true }).selectOption('quantity-contact-a');
  await crew(1).getByLabel('Trade', { exact: true }).fill('Formwork');
  await crew(1).getByRole('textbox', { name: 'Workers', exact: true }).fill('2');

  await contractors.getByRole('button', { name: 'Add contractor', exact: true }).click();
  await crew(2).getByRole('combobox', { name: 'Contractor / company name', exact: true }).selectOption({ label: 'New contractor' });
  await crew(2).getByRole('textbox', { name: 'New contractor', exact: true }).fill('New QA Contractor');
  await crew(2).getByRole('button', { name: 'Save and select contractor', exact: true }).click();
  await page.waitForFunction(async () => {
    const { db } = await import('/src/db.ts');
    return (await db.contacts.toArray()).some(contact => contact.name === 'New QA Contractor');
  });
  const newContactUid = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    return (await db.contacts.toArray()).find(contact => contact.name === 'New QA Contractor').uid;
  });
  await page.waitForFunction(contactUid => [...document.querySelectorAll('.contractor-editor select')].some(select => select.value === contactUid), newContactUid);
  await crew(2).getByLabel('Trade', { exact: true }).fill('Electrical');
  const workers = crew(2).getByRole('textbox', { name: 'Workers', exact: true });
  await workers.fill('3 + 1');
  assert.equal(await workers.getAttribute('aria-invalid'), 'true');
  assert(await crew(2).getByRole('button', { name: 'Add one', exact: true }).isDisabled());
  assert.equal(await workers.inputValue(), '3 + 1');
  await workers.fill('4');

  // Navigating immediately exercises the editor's pending-write flush.
  await leaveAndWaitFor('contractors');
  await reopenA();
  await openContractors();
  assert.equal(await crew(0).getByRole('combobox', { name: 'Contractor / company name', exact: true }).inputValue(), 'quantity-contact-a');
  assert.equal(await crew(1).getByRole('combobox', { name: 'Contractor / company name', exact: true }).inputValue(), 'quantity-contact-a');
  assert.equal(await crew(2).getByRole('combobox', { name: 'Contractor / company name', exact: true }).inputValue(), newContactUid);
  assert.equal(await crew(0).getByRole('textbox', { name: 'Workers', exact: true }).inputValue(), '3');
  assert.equal(await crew(1).getByRole('textbox', { name: 'Workers', exact: true }).inputValue(), '2');

  // Renaming the address-book record never rewrites the recorded day's name.
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    await db.contacts.where('uid').equals('quantity-contact-a').modify({ name: 'Renamed QA Contact' });
  });
  assert((await crew(0).getByRole('combobox', { name: 'Contractor / company name', exact: true }).locator('option:checked').textContent()).includes('Same Contractor'));

  await openDeliveries();
  const ledger = page.locator('.quantity-ledger');
  const delivery = index => ledger.locator('.row-item').nth(index);
  await ledger.getByRole('button', { name: 'Add delivery note · Concrete', exact: true }).click();
  await delivery(0).getByLabel('Qty', { exact: true }).fill('5.125');
  await delivery(0).getByLabel('Supplier', { exact: true }).fill('QA Concrete Supplier');
  await delivery(0).getByLabel('Delivery note number', { exact: true }).fill('QA-CON-001');
  await delivery(0).getByLabel('Material type / specification', { exact: true }).fill('C30');
  await delivery(0).getByLabel('Building / floor / area', { exact: true }).fill('Building A, slab 2');

  await ledger.getByRole('button', { name: 'Add delivery note · Steel', exact: true }).click();
  await delivery(1).getByLabel('Qty', { exact: true }).fill('1250');
  await delivery(1).getByRole('combobox', { name: 'Choose from contacts', exact: true }).selectOption('quantity-contact-b');
  assert.equal(await delivery(1).getByLabel('Supplier', { exact: true }).inputValue(), 'Same Contractor');
  await delivery(1).getByLabel('Delivery note number', { exact: true }).fill('QA-ST-001');
  await delivery(1).getByLabel('Material type / specification', { exact: true }).fill('B500, 12 mm');
  const reviewed = ledger.getByRole('checkbox');
  await reviewed.check();
  await delivery(1).getByRole('combobox', { name: 'Unit', exact: true }).selectOption('tonne');
  assert.equal(await delivery(1).getByLabel('Qty', { exact: true }).inputValue(), '');
  assert(!(await reviewed.isChecked()));
  await delivery(1).getByLabel('Qty', { exact: true }).fill('1,250');
  assert.equal(await delivery(1).getByLabel('Qty', { exact: true }).getAttribute('aria-invalid'), 'true');
  assert.equal(await delivery(1).getByLabel('Qty', { exact: true }).inputValue(), '1,250');
  await delivery(1).getByLabel('Qty', { exact: true }).fill('1.25');
  await reviewed.check();
  await delivery(1).getByRole('combobox', { name: 'Material', exact: true }).selectOption('concrete');
  assert.equal(await delivery(1).getByRole('combobox', { name: 'Unit', exact: true }).inputValue(), 'm3');
  assert.equal(await delivery(1).getByLabel('Qty', { exact: true }).inputValue(), '');
  assert(!(await reviewed.isChecked()));
  await delivery(1).getByRole('combobox', { name: 'Material', exact: true }).selectOption('steel');
  await delivery(1).getByRole('combobox', { name: 'Unit', exact: true }).selectOption('tonne');
  await delivery(1).getByLabel('Qty', { exact: true }).fill('1.25');
  await reviewed.check();
  await delivery(0).getByLabel('Notes', { exact: true }).fill('Checked against delivery note');
  assert(!(await reviewed.isChecked()));
  await reviewed.check();
  await leaveAndWaitFor('deliveries');
  await reopenA();
  await openDeliveries();
  assert.equal(await delivery(0).getByLabel('Qty', { exact: true }).inputValue(), '5.125');
  assert.equal(await delivery(0).getByLabel('Notes', { exact: true }).inputValue(), 'Checked against delivery note');
  assert.equal(await delivery(1).getByLabel('Qty', { exact: true }).inputValue(), '1.25');
  assert.equal(await delivery(1).getByRole('combobox', { name: 'Unit', exact: true }).inputValue(), 'tonne');
  assert.equal(await delivery(1).getByRole('combobox', { name: 'Choose from contacts', exact: true }).inputValue(), 'quantity-contact-b');
  assert(await reviewed.isChecked());

  await page.evaluate(async ({ projectBId, entryBId }) => {
    const { db, ACTIVE_PROJECT_KEY } = await import('/src/db.ts');
    location.hash = '/entries';
    await db.settings.put({ key: ACTIVE_PROJECT_KEY, value: projectBId });
    location.hash = `/entry/${entryBId}`;
  }, seed);
  await page.reload();
  await page.locator('h1').filter({ hasText: '01/09/2026' }).waitFor();
  await openDeliveries();
  assert.equal(await ledger.locator('.row-item').count(), 1);
  assert.equal(await delivery(0).getByLabel('Qty', { exact: true }).inputValue(), '999');
  assert.equal(await delivery(0).getByLabel('Supplier', { exact: true }).inputValue(), 'OTHER PROJECT SUPPLIER');
  const afterB = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    const entry = await db.entries.where('uid').equals('quantity-ui-day-b').first();
    return JSON.stringify({ contractors: entry.contractors, deliveryLedger: entry.deliveryLedger });
  });
  assert.equal(afterB, seed.beforeB);

  // The same complete editor must fit a Hebrew phone viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const { applyLanguage } = await import('/src/i18n/useLanguage.ts');
    localStorage.setItem('yoman-lang', 'he');
    applyLanguage('he');
    window.dispatchEvent(new Event('yoman-language'));
  });
  await page.waitForFunction(() => document.documentElement.dir === 'rtl');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Delivery editor overflows the phone width');
  await mkdir('tmp', { recursive: true });
  await page.screenshot({ path: 'tmp/check-quantity-editor-he.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Quantity editor checks passed: explicit contact creation and stable UID, same-contact crews, invalid inputs retained, unit/material changes, reviewed-state reset, persistence/reload, contact snapshots, project isolation and Hebrew mobile layout.');
} finally {
  await context.close();
  await browser.close();
}
