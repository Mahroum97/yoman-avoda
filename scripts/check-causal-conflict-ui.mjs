/**
 * Same-UID offline conflict regression with two independent browser diaries.
 * Both contexts use fresh synthetic IndexedDB/localStorage; no installed diary
 * or physical device is opened.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.YOMAN_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.YOMAN_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });

async function makePeer(actor) {
  const context = await browser.newContext();
  await context.addInitScript(actorId => {
    localStorage.setItem('yoman-lang', 'en');
    localStorage.setItem('yoman-theme', 'light');
    localStorage.setItem('yoman-photos-bytes', 'test');
    localStorage.setItem('yoman-entry-revision-device', actorId);
    window.confirm = () => true;
    window.__savedFiles = [];
    window.yoman = {
      platform: 'test',
      version: 'test',
      saveFile: async (name, bytes) => {
        window.__savedFiles.push({ name, size: bytes.length });
        return { saved: true };
      },
    };
  }, actor);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/#/`);
  return { context, page, errors };
}

async function entryPayload(page, uids, projectUids = []) {
  return page.evaluate(async ({ entries, projects }) => {
    const { collectPayload } = await import('/src/sync/store.ts');
    return collectPayload({
      projects,
      entries,
      contacts: [],
      settings: [],
    });
  }, { entries: uids, projects: projectUids });
}

async function apply(page, payload) {
  return page.evaluate(async incoming => {
    const { applyPayload } = await import('/src/sync/store.ts');
    return applyPayload(incoming);
  }, payload);
}

async function rows(page) {
  return page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    return (await db.entries.toArray()).map(entry => ({
      id: entry.id,
      uid: entry.uid,
      date: entry.date,
      text: entry.workDescription,
      deletedAt: entry.deletedAt,
      conflict: !!entry.syncConflict,
      kind: entry.syncConflictKind,
      group: entry.syncConflictGroup,
      root: entry.syncConflictRoot,
      revision: entry.syncRevision,
      updatedAt: entry.updatedAt,
    }));
  });
}

async function editAtSameClock(page, uid, text, now) {
  return page.evaluate(async ({ entryUid, nextText, fixedNow }) => {
    const { db, saveEntry } = await import('/src/db.ts');
    const entry = await db.entries.where('uid').equals(entryUid).first();
    const originalNow = Date.now;
    Date.now = () => fixedNow;
    try {
      await saveEntry({ ...entry, workDescription: nextText });
    } finally {
      Date.now = originalNow;
    }
    const saved = await db.entries.where('uid').equals(entryUid).first();
    return { updatedAt: saved.updatedAt, revision: saved.syncRevision };
  }, { entryUid: uid, nextText: text, fixedNow: now });
}

async function seedSlowCheckedConflict(page, date, localText, actor) {
  return page.evaluate(async ({ entryDate, draftText, editorActor }) => {
    const { blankEntry, createProject, db } = await import('/src/db.ts');
    const {
      advanceEntryRevision,
      legacyEntryRevision,
      revisionWinner,
    } = await import('/src/sync/revision.ts');
    let project = await db.projects.toCollection().first();
    if (!project) {
      const projectId = await createProject({ name: 'Checked alias QA', address: '', company: '' });
      project = await db.projects.get(projectId);
    }
    const entry = blankEntry(project.id, entryDate, project.uid);
    entry.workDescription = 'CHECKED COMMON BASE';
    entry.photos = [{
      id: `slow-${entryDate}`,
      caption: '',
      blob: new Blob([new Uint8Array([11, 22, 33, 44])], { type: 'image/jpeg' }),
      width: 1,
      height: 1,
      takenAt: 1,
    }];
    entry.syncRevision = legacyEntryRevision(entry);
    entry.id = await db.entries.add(entry);

    const bytes = new Uint8Array(await entry.photos[0].blob.arrayBuffer());
    const localCandidate = {
      ...entry,
      workDescription: draftText,
      photos: [{ ...entry.photos[0], blob: undefined, bytes }],
    };
    const localRevision = advanceEntryRevision(
      localCandidate,
      entry.syncRevision,
      editorActor,
    );
    let remote;
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const candidate = { ...entry, workDescription: `REMOTE PRESERVED ${entryDate} ${attempt}` };
      const syncRevision = advanceEntryRevision(
        candidate,
        entry.syncRevision,
        `remote-${entryDate}`,
      );
      // persistEntry calls revisionWinner(current, visible). Force the stored
      // branch to retain the original UID so the editor must adopt a new one.
      if (revisionWinner(syncRevision, localRevision) === 'local') {
        remote = { ...candidate, syncRevision };
        break;
      }
    }
    if (!remote) throw new Error('could not construct deterministic alias fixture');
    window.__checkedPlans ??= {};
    window.__checkedPlans[entry.id] = { remote };
    return { id: entry.id, uid: entry.uid, remoteText: remote.workDescription };
  }, { entryDate: date, draftText: localText, editorActor: actor });
}

async function installSlowBlobGate(page) {
  await page.evaluate(() => {
    const original = Blob.prototype.arrayBuffer;
    let release;
    let entered;
    const gate = new Promise(resolve => { release = resolve; });
    window.__slowBlobEntered = new Promise(resolve => { entered = resolve; });
    window.__releaseSlowBlob = release;
    window.__restoreBlobRead = () => { Blob.prototype.arrayBuffer = original; };
    Blob.prototype.arrayBuffer = async function () {
      entered();
      await gate;
      return original.call(this);
    };
  });
}

async function installRemoteRevision(page, id) {
  await page.evaluate(async entryId => {
    const { db } = await import('/src/db.ts');
    const current = await db.entries.get(entryId);
    const remote = window.__checkedPlans[entryId].remote;
    await db.entries.put({ ...remote, id: current.id, updatedAt: current.updatedAt + 100 });
  }, id);
}

async function openSection(page, id) {
  const toggle = page.locator(`#section-${id} .card__toggle`);
  await toggle.waitFor();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

const peerA = await makePeer('causal-peer-a');
const peerB = await makePeer('causal-peer-b');
const aliasPeer = await makePeer('causal-alias-editor');

try {
  const baseState = await peerA.page.evaluate(async () => {
    const { blankEntry, createProject, db, saveEntry } = await import('/src/db.ts');
    const projectId = await createProject({ name: 'Causal UI QA', address: '', company: '' });
    const project = await db.projects.get(projectId);
    const entry = blankEntry(projectId, '2026-09-22', project.uid);
    entry.workDescription = 'COMMON BASE';
    await saveEntry(entry);
    const stored = await db.entries.where('uid').equals(entry.uid).first();
    return {
      projectUid: project.uid,
      entryUid: stored.uid,
      updatedAt: stored.updatedAt,
    };
  });

  // Clone the common causal base, then disconnect the two browser diaries.
  const basePayload = await entryPayload(
    peerA.page,
    [baseState.entryUid],
    [baseState.projectUid],
  );
  await apply(peerB.page, basePayload);

  const tiedClock = baseState.updatedAt + 10_000;
  const [headA, headB] = await Promise.all([
    editAtSameClock(peerA.page, baseState.entryUid, 'OFFLINE BRANCH A', tiedClock),
    editAtSameClock(peerB.page, baseState.entryUid, 'OFFLINE BRANCH B', tiedClock),
  ]);
  assert.equal(headA.updatedAt, headB.updatedAt, 'fixture did not produce equal wall-clock stamps');
  assert.notEqual(headA.revision, headB.revision, 'independent peers produced one causal head');

  // A receives B's same-UID branch. Reapplying the same old payload must not
  // grow a third copy, and a full round trip must converge on the same UIDs.
  const bBranch = await entryPayload(peerB.page, [baseState.entryUid]);
  await apply(peerA.page, bBranch);
  await apply(peerA.page, bBranch);
  const firstMerge = await rows(peerA.page);
  assert.equal(firstMerge.length, 2, `same-UID merge did not preserve exactly two branches: ${JSON.stringify(firstMerge)}`);
  assert.deepEqual(firstMerge.map(row => row.text).sort(), ['OFFLINE BRANCH A', 'OFFLINE BRANCH B']);
  assert(firstMerge.every(row => row.conflict && row.group && row.root === baseState.entryUid));

  const allFromA = await entryPayload(peerA.page, firstMerge.map(row => row.uid));
  await apply(peerB.page, allFromA);
  const allFromB = await entryPayload(peerB.page, (await rows(peerB.page)).map(row => row.uid));
  await apply(peerA.page, allFromB);
  const convergedA = await rows(peerA.page);
  const convergedB = await rows(peerB.page);
  assert.deepEqual(convergedA.map(row => row.uid).sort(), convergedB.map(row => row.uid).sort());
  assert.equal(convergedA.length, 2, 'round-trip sync grew duplicate conflict branches');

  // The conflict must be visible in both the diary and the editor.
  await peerA.page.goto(`${base}/#/`);
  await peerA.page.getByText('Sync conflict · both versions were kept', { exact: true }).waitFor();
  await peerA.page.getByText('OFFLINE BRANCH A', { exact: true }).waitFor();
  await peerA.page.getByText('OFFLINE BRANCH B', { exact: true }).waitFor();
  await peerA.page.evaluate(id => { location.hash = `#/entry/${id}`; }, convergedA[0].id);
  await peerA.page.getByText('Sync conflict · both versions were kept', { exact: true }).waitFor();

  // Selection export is a second entry point to reports and must refuse the
  // unresolved pair before invoking any file bridge.
  await peerA.page.evaluate(() => { location.hash = '#/'; });
  await peerA.page.getByRole('button', { name: 'View', exact: true }).click();
  await peerA.page.getByRole('menuitem', { name: 'Select items', exact: true }).click();
  for (const open of await peerA.page.locator('.entry__open').all()) await open.click();
  await peerA.page.getByRole('button', { name: 'Report from selected', exact: true }).click();
  await peerA.page.locator('.toast').getByText(
    'Two versions of a diary page were preserved. Review both and move the version you do not need to the Trash before creating a report.',
    { exact: true },
  ).waitFor();
  assert.equal(await peerA.page.evaluate(() => window.__savedFiles.length), 0);

  // Deliberately trash one branch through the real editor action. The local UI
  // clears the survivor marker, and the soft-delete revision carries that
  // resolution to the other peer without resurrecting either version.
  await peerA.page.evaluate(id => { location.hash = `#/entry/${id}`; }, convergedA[0].id);
  await peerA.page.locator('.actionmenu__button').click();
  await peerA.page.getByRole('menuitem', { name: /Delete entry/ }).click();
  await peerA.page.waitForFunction(() => location.hash === '#/');
  const resolvedA = await rows(peerA.page);
  const liveA = resolvedA.filter(row => row.deletedAt === undefined);
  assert.equal(liveA.length, 1);
  assert.equal(liveA[0].conflict, false, 'local conflict survivor stayed marked');

  const resolution = await entryPayload(peerA.page, resolvedA.map(row => row.uid));
  await apply(peerB.page, resolution);
  const resolvedB = await rows(peerB.page);
  const liveB = resolvedB.filter(row => row.deletedAt === undefined);
  assert.equal(liveB.length, 1);
  assert.equal(liveB[0].conflict, false, 'peer did not receive conflict resolution');
  assert.equal(liveB[0].text, liveA[0].text);

  await peerA.page.getByText('Sync conflict · both versions were kept', { exact: true })
    .waitFor({ state: 'hidden' });

  // A permanent deletion racing a causally-independent edit has one live row
  // and one tombstone. It needs different guidance and must remain unexportable
  // until Save explicitly keeps the work or Trash confirms the deletion.
  const deletionBase = await peerA.page.evaluate(async () => {
    const { blankEntry, db, saveEntry } = await import('/src/db.ts');
    const project = await db.projects.toCollection().first();
    const entry = blankEntry(project.id, '2026-09-25', project.uid);
    entry.workDescription = 'DELETE CONFLICT BASE';
    await saveEntry(entry);
    const stored = await db.entries.where('uid').equals(entry.uid).first();
    return { uid: stored.uid, id: stored.id };
  });
  await apply(peerB.page, await entryPayload(peerA.page, [deletionBase.uid]));
  await editAtSameClock(
    peerA.page,
    deletionBase.uid,
    'CONCURRENT EDIT KEPT FOR REVIEW',
    9_000_000_700_000,
  );
  await peerB.page.evaluate(async uid => {
    const { db, deleteEntry, purgeEntry } = await import('/src/db.ts');
    const entry = await db.entries.where('uid').equals(uid).first();
    const originalNow = Date.now;
    Date.now = () => 9_000_900_000_000;
    try {
      await deleteEntry(entry.id);
      await purgeEntry(entry.id);
    } finally {
      Date.now = originalNow;
    }
  }, deletionBase.uid);
  for (let round = 0; round < 3; round += 1) {
    const bState = await rows(peerB.page);
    await apply(peerA.page, await entryPayload(peerB.page, bState.map(row => row.uid)));
    const aState = await rows(peerA.page);
    await apply(peerB.page, await entryPayload(peerA.page, aState.map(row => row.uid)));
  }
  const deletionConflictA = (await rows(peerA.page)).find(row => row.uid === deletionBase.uid);
  const deletionConflictB = (await rows(peerB.page)).find(row => row.uid === deletionBase.uid);
  assert(deletionConflictA && deletionConflictB);
  assert.equal(deletionConflictA.conflict, true);
  assert.equal(deletionConflictB.conflict, true);
  assert.equal(deletionConflictA.kind, 'deletion');
  assert.equal(deletionConflictB.kind, 'deletion');

  await peerA.page.goto(`${base}/#/`);
  await peerA.page.getByText('Sync conflict · deletion needs review', { exact: true }).waitFor();
  const deleteConflictRow = peerA.page.locator('.entry').filter({
    hasText: 'CONCURRENT EDIT KEPT FOR REVIEW',
  });
  await deleteConflictRow.locator('.entry__action').click();
  await peerA.page.locator('.toast').getByText(
    'Another device deleted this page while this copy was edited. Review it, then save it to keep the work or move it to the Trash to confirm the deletion before creating a report.',
    { exact: true },
  ).waitFor();
  assert.equal(await peerA.page.evaluate(() => window.__savedFiles.length), 0);

  await peerA.page.evaluate(id => { location.hash = `#/entry/${id}`; }, deletionConflictA.id);
  await peerA.page.getByText('Sync conflict · deletion needs review', { exact: true }).waitFor();
  await peerA.page.locator('.actionmenu__button').click();
  const blockedPreview = peerA.page.getByRole('menuitem', { name: /Preview/ });
  assert.equal(await blockedPreview.isDisabled(), true);
  await peerA.page.getByRole('menuitem', { name: /Create PDF/ }).click();
  await peerA.page.locator('.toast').getByText(
    'Another device deleted this page while this copy was edited. Review it, then save it to keep the work or move it to the Trash to confirm the deletion before creating a report.',
    { exact: true },
  ).waitFor();
  assert.equal(await peerA.page.evaluate(() => window.__savedFiles.length), 0);

  await peerA.page.evaluate(id => { location.hash = `#/preview/${id}`; }, deletionConflictA.id);
  await peerA.page.getByText('Sync conflict · deletion needs review', { exact: true }).waitFor();
  assert.equal(await peerA.page.getByRole('button', { name: 'Create PDF', exact: true }).count(), 0);

  // Save is the explicit Keep choice. Its causal head joins the tombstone,
  // clears the marker, and makes preview/report export reachable again.
  await peerA.page.evaluate(id => { location.hash = `#/entry/${id}`; }, deletionConflictA.id);
  await peerA.page.locator('.actionbar__inner').getByRole('button', {
    name: 'Save', exact: true,
  }).click();
  await peerA.page.getByText('Sync conflict · deletion needs review', { exact: true })
    .waitFor({ state: 'hidden' });
  for (let round = 0; round < 3; round += 1) {
    const aState = await rows(peerA.page);
    await apply(peerB.page, await entryPayload(peerA.page, aState.map(row => row.uid)));
    const bState = await rows(peerB.page);
    await apply(peerA.page, await entryPayload(peerB.page, bState.map(row => row.uid)));
  }
  const keptA = (await rows(peerA.page)).find(row => row.uid === deletionBase.uid);
  const keptB = (await rows(peerB.page)).find(row => row.uid === deletionBase.uid);
  assert(keptA && keptB && !keptA.deletedAt && !keptB.deletedAt);
  assert.equal(keptA.conflict, false);
  assert.equal(keptB.conflict, false);
  const staleStones = await Promise.all([peerA.page, peerB.page].map(page =>
    page.evaluate(async uid => (await import('/src/db.ts')).db.tombstones.get(uid), deletionBase.uid),
  ));
  assert(
    staleStones.every(stone => stone === undefined),
    `explicit Keep left a stale deletion head: ${JSON.stringify(staleStones)}`,
  );
  await peerA.page.evaluate(id => { location.hash = `#/preview/${id}`; }, keptA.id);
  await peerA.page.getByRole('button', { name: 'Create PDF', exact: true }).waitFor();

  // Checked-save branch reassignment while a newer editor revision is queued.
  // A slow legacy photo holds the first save before its transaction; a remote
  // head replaces the stored row, then the second local edit must follow the
  // canonical UID returned by the first save instead of overwriting the remote.
  const queued = await seedSlowCheckedConflict(
    aliasPeer.page,
    '2026-09-23',
    'LOCAL FIRST REVISION',
    'causal-alias-editor',
  );
  await aliasPeer.page.goto(`${base}/#/entry/${queued.id}`);
  await openSection(aliasPeer.page, 'work');
  await installSlowBlobGate(aliasPeer.page);
  const queuedText = aliasPeer.page.locator('#section-work textarea');
  await queuedText.fill('LOCAL FIRST REVISION');
  await aliasPeer.page.locator('.actionbar__inner').getByRole('button', {
    name: 'Save', exact: true,
  }).click();
  await aliasPeer.page.evaluate(() => window.__slowBlobEntered);
  await queuedText.fill('LOCAL SECOND REVISION');
  await installRemoteRevision(aliasPeer.page, queued.id);
  await aliasPeer.page.evaluate(async () => {
    window.__releaseSlowBlob();
    try {
      await (await import('/src/lib/pendingWrites.ts')).flushPendingWrites();
    } finally {
      window.__restoreBlobRead();
    }
  });
  const queuedRows = (await rows(aliasPeer.page)).filter(row => row.date === '2026-09-23');
  assert.equal(queuedRows.length, 2, `queued canonical save grew/lost branches: ${JSON.stringify(queuedRows)}`);
  assert.deepEqual(
    queuedRows.map(row => row.text).sort(),
    ['LOCAL SECOND REVISION', queued.remoteText].sort(),
  );
  const visibleBranch = queuedRows.find(row => row.text === 'LOCAL SECOND REVISION');
  assert.notEqual(visibleBranch.uid, queued.uid, 'fixture did not force checked UID reassignment');
  assert.equal(await queuedText.inputValue(), 'LOCAL SECOND REVISION');
  assert.equal(new URL(aliasPeer.page.url()).hash, `#/entry/${visibleBranch.id}`);
  assert(queuedRows.every(row => row.conflict && row.group));

  // The same alias must guide Delete if it is pressed while the checked save
  // is still blocked on the photo. Otherwise Delete removes the preserved
  // original branch and leaves the draft the user explicitly deleted.
  const deleting = await seedSlowCheckedConflict(
    aliasPeer.page,
    '2026-09-24',
    'LOCAL DELETE REVISION',
    'causal-alias-editor',
  );
  await aliasPeer.page.goto(`${base}/#/entry/${deleting.id}`);
  await openSection(aliasPeer.page, 'work');
  await installSlowBlobGate(aliasPeer.page);
  await aliasPeer.page.locator('#section-work textarea').fill('LOCAL DELETE REVISION');
  await aliasPeer.page.evaluate(() => window.__slowBlobEntered);
  await installRemoteRevision(aliasPeer.page, deleting.id);
  await aliasPeer.page.locator('.actionmenu__button').click();
  await aliasPeer.page.getByRole('menuitem', { name: /Delete entry/ }).click();
  await aliasPeer.page.evaluate(() => {
    window.__releaseSlowBlob();
    window.__restoreBlobRead();
  });
  await aliasPeer.page.waitForFunction(() => location.hash === '#/');
  const deleteRows = (await rows(aliasPeer.page)).filter(row => row.date === '2026-09-24');
  assert.equal(deleteRows.length, 2);
  const deletedDraft = deleteRows.find(row => row.text === 'LOCAL DELETE REVISION');
  const remoteSurvivor = deleteRows.find(row => row.text === deleting.remoteText);
  assert.equal(typeof deletedDraft.deletedAt, 'number', 'Delete targeted the preserved branch');
  assert.equal(remoteSurvivor.deletedAt, undefined);
  assert.equal(remoteSurvivor.conflict, false, 'Delete did not resolve the preserved survivor');

  assert.deepEqual(peerA.errors, []);
  assert.deepEqual(peerB.errors, []);
  assert.deepEqual(aliasPeer.errors, []);
  console.log('Causal conflict UI passed: same-UID peers converged, revision/deletion exports blocked until resolution, and queued checked-save/delete work followed deterministic branch aliases.');
} finally {
  await peerA.context.close();
  await peerB.context.close();
  await aliasPeer.context.close();
  await browser.close();
}
