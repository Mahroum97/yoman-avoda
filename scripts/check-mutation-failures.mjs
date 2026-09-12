/**
 * Failure/re-entry regressions for explicit editor, contact and Trash writes.
 * Fresh Chromium storage only; never opens an installed app profile.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.YOMAN_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.YOMAN_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem('yoman-lang', 'en');
  localStorage.setItem('yoman-theme', 'light');
  localStorage.setItem('yoman-photos-bytes', 'test');
  window.confirm = () => true;
});

async function seedProject() {
  return page.evaluate(async () => {
    const { createProject, db, setSetting, ACTIVE_PROJECT_KEY } = await import('/src/db.ts');
    const projectId = await createProject({ name: 'Mutation QA', address: '', company: '' });
    await setSetting(ACTIVE_PROJECT_KEY, projectId);
    return { projectId, projectUid: (await db.projects.get(projectId)).uid };
  });
}

async function editorFailure(project) {
  await page.goto(`${base}/#/entry/new?date=2026-09-20`);
  await page.locator('#section-work .card__toggle').click();
  const textarea = page.locator('#section-work textarea');
  await page.evaluate(() => {
    window.__entryPut = IDBObjectStore.prototype.put;
    window.__entryPutAttempts = 0;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'entries') {
        window.__entryPutAttempts += 1;
        throw new DOMException('injected entry put failure', 'QuotaExceededError');
      }
      return window.__entryPut.apply(this, args);
    };
  });
  await textarea.fill('VISIBLE EDIT RETAINED AFTER FAILURE');

  const save = page.locator('.actionbar__inner').getByRole('button', { name: 'Save', exact: true });
  await save.waitFor();
  assert.equal(await save.isEnabled(), true);
  await save.evaluate(button => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForFunction(() => window.__entryPutAttempts > 0);
  assert.equal(await page.evaluate(() => window.__entryPutAttempts), 1, 'same-tick Save re-entered');
  await page.getByRole('alert').getByText('The entry was not saved', { exact: true }).waitFor();
  assert.equal(await textarea.inputValue(), 'VISIBLE EDIT RETAINED AFTER FAILURE');
  assert.equal(await page.evaluate(async () => (await import('/src/db.ts')).db.entries.count()), 0);

  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__entryPut; });
  await page.getByRole('alert').getByRole('button', { name: 'Try again', exact: true }).click();
  await page.waitForFunction(() => /^#\/entry\/\d+$/.test(location.hash));
  const saved = await page.evaluate(async () => (await import('/src/db.ts')).db.entries.toArray());
  assert.equal(saved.length, 1);
  assert.equal(saved[0].workDescription, 'VISIBLE EDIT RETAINED AFTER FAILURE');
  assert.equal(saved[0].projectId, project.projectId);
}

async function contactsFailures() {
  await page.evaluate(() => { location.hash = '#/contacts'; });
  await page.getByRole('heading', { name: 'Suppliers & contractors', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { blankContact, saveContact } = await import('/src/db.ts');
    const row = blankContact();
    row.name = 'Stored name';
    await saveContact(row);
  });
  const first = page.locator('.ctable__row').first();
  const name = first.getByLabel('Contractor or supplier', { exact: true });
  await name.waitFor();

  await name.fill('CENTRAL FLUSHED CONTACT');
  await page.evaluate(async () => (await import('/src/lib/pendingWrites.ts')).flushPendingWrites());
  assert.equal(
    await page.evaluate(async () => (await (await import('/src/db.ts')).db.contacts.toArray())[0].name),
    'CENTRAL FLUSHED CONTACT',
    'central pending-write flush omitted the visible contact edit',
  );

  await page.evaluate(() => {
    window.__contactPut = IDBObjectStore.prototype.put;
    window.__contactPutAttempts = 0;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'contacts') {
        window.__contactPutAttempts += 1;
        throw new DOMException('injected contact put failure', 'QuotaExceededError');
      }
      return window.__contactPut.apply(this, args);
    };
  });
  await name.fill('PENDING CONTACT TEXT');
  await page.getByRole('heading', { name: 'Suppliers & contractors', exact: true }).click();
  await page.getByRole('alert').getByText('Contact changes were not saved', { exact: true }).waitFor();
  assert.equal(await name.inputValue(), 'PENDING CONTACT TEXT', 'failed edit rolled back on screen');
  assert.equal(
    await page.evaluate(async () => (await (await import('/src/db.ts')).db.contacts.toArray())[0].name),
    'CENTRAL FLUSHED CONTACT',
  );

  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__contactPut; });
  const retry = page.getByRole('alert').getByRole('button', { name: 'Try again', exact: true });
  await retry.evaluate(button => { button.click(); button.click(); });
  await page.getByRole('alert').waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(async () => (await (await import('/src/db.ts')).db.contacts.toArray())[0].name),
    'PENDING CONTACT TEXT',
  );

  // New row has its own same-tick mutex as well.
  const add = page.getByRole('button', { name: 'New row', exact: true }).first();
  await add.evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(async () => (await (await import('/src/db.ts')).db.contacts.count()) === 2);
  assert.equal(await page.evaluate(async () => (await import('/src/db.ts')).db.contacts.count()), 2);

  await page.evaluate(() => {
    window.__contactDelete = IDBObjectStore.prototype.delete;
    window.__contactDeleteAttempts = 0;
    IDBObjectStore.prototype.delete = function (...args) {
      if (this.name === 'contacts') {
        window.__contactDeleteAttempts += 1;
        throw new DOMException('injected contact delete failure', 'QuotaExceededError');
      }
      return window.__contactDelete.apply(this, args);
    };
  });
  const remove = first.getByRole('button', { name: 'Delete row', exact: true });
  await remove.evaluate(button => { button.click(); button.click(); });
  await page.getByText('The row was not deleted.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__contactDeleteAttempts), 1, 'contact Delete re-entered');
  assert.equal(await name.inputValue(), 'PENDING CONTACT TEXT');
  await page.evaluate(() => { IDBObjectStore.prototype.delete = window.__contactDelete; });
}

async function trashFailure(project) {
  const entryId = await page.evaluate(async ({ projectId, projectUid }) => {
    const { blankEntry, deleteEntry, saveEntry } = await import('/src/db.ts');
    const entry = blankEntry(projectId, '2026-09-21', projectUid);
    entry.workDescription = 'TRASH FAILURE QA';
    const id = await saveEntry(entry);
    await deleteEntry(id);
    return id;
  }, project);
  await page.evaluate(() => { location.hash = '#/trash'; });
  await page.getByRole('heading', { name: 'Trash', exact: true }).waitFor();
  const checkbox = page.locator('.trash-row__pick').first();
  await checkbox.check();
  await page.evaluate(() => {
    window.__trashDelete = IDBObjectStore.prototype.delete;
    window.__trashDeleteAttempts = 0;
    IDBObjectStore.prototype.delete = function (...args) {
      if (this.name === 'entries') {
        window.__trashDeleteAttempts += 1;
        throw new DOMException('injected trash delete failure', 'QuotaExceededError');
      }
      return window.__trashDelete.apply(this, args);
    };
  });
  const purge = page.getByRole('button', { name: 'Delete for good', exact: true });
  await purge.evaluate(button => { button.click(); button.click(); });
  await page.getByText('The action stopped. Any pages still shown remain in the Trash.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__trashDeleteAttempts), 1, 'Trash purge re-entered');
  assert.equal(await checkbox.isChecked(), true, 'failed Trash selection was cleared');
  const stored = await page.evaluate(async id => (await import('/src/db.ts')).db.entries.get(id), entryId);
  assert.equal(typeof stored.deletedAt, 'number', 'failed purge removed the page');
  assert.equal(await purge.isEnabled(), true, 'Trash action remained stuck busy after failure');
  await page.evaluate(() => { IDBObjectStore.prototype.delete = window.__trashDelete; });
}

try {
  await page.goto(`${base}/#/projects`);
  const project = await seedProject();
  await editorFailure(project);
  await contactsFailures();
  await trashFailure(project);
  assert.deepEqual(pageErrors, [], `uncaught page errors: ${pageErrors.join('\n')}`);
  console.log('Mutation failures passed: editor Save, contact autosave/add/delete, and Trash purge retain state, reject re-entry, and recover for retry.');
} finally {
  await context.close();
  await browser.close();
}
