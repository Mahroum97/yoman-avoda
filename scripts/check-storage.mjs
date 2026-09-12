/**
 * Fresh browser contexts and synthetic IndexedDB records only; never opens an installed app profile.
 * Start Vite on :5173, then run:
 * YOMAN_PLAYWRIGHT_PATH=/path/to/playwright node scripts/check-storage.mjs
 */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.YOMAN_PLAYWRIGHT_PATH || 'playwright');

const base = process.env.YOMAN_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });

function check(value, message) {
  if (!value) throw new Error(message);
}

async function directStorageChecks() {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('yoman-photos-bytes', 'test'));
  const page = await context.newPage();
  await page.goto(`${base}/favicon.svg`);
  const result = await page.evaluate(async () => {
    const mod = await import('/src/db.ts?direct-storage-check');
    const {
      db, blankEntry, blankContact, createProject, updateProject, saveEntry, saveContact,
      saveEntryChecked, deleteProject, deleteEntry, purgeEntry, backupToJson, restoreEntry,
      restoreFromJson, restoreFromTrash, setSetting,
    } = mod;
    await db.open();
    await db.transaction('rw', [db.projects, db.entries, db.contacts, db.presets, db.settings, db.tombstones], async () => {
      await Promise.all([
        db.projects.clear(), db.entries.clear(), db.contacts.clear(), db.presets.clear(),
        db.settings.clear(), db.tombstones.clear(),
      ]);
    });

    const originalSettingPut = db.settings.put.bind(db.settings);
    db.settings.put = async () => {
      throw new Error('synthetic first-active-setting failure');
    };
    const failedCreate = await Promise.allSettled([
      createProject({ name: 'must roll back', address: '', company: '' }),
    ]);
    db.settings.put = originalSettingPut;
    const createRolledBack =
      failedCreate[0].status === 'rejected' && (await db.projects.count()) === 0;

    const projectId = await createProject({ name: 'test', address: '', company: '' });
    const project = await db.projects.get(projectId);
    const a = blankEntry(projectId, '2026-09-01', project.uid);
    const b = blankEntry(projectId, '2026-09-01', project.uid);
    const concurrent = await Promise.allSettled([saveEntry(a), saveEntry(b)]);
    const liveSameDate = await db.entries.where({ projectId, date: '2026-09-01' }).filter((e) => e.deletedAt === undefined).count();

    const stale = await db.entries.where('uid').equals(a.uid).first();
    await deleteEntry(stale.id);
    await saveEntry({ ...stale, workDescription: 'stale editor write' });
    const afterSoftDelete = await db.entries.get(stale.id);
    await purgeEntry(stale.id);
    const hardDeleteWrite = await Promise.allSettled([saveEntry({ ...stale, workDescription: 'after purge' })]);
    const afterHardDelete = await db.entries.where('uid').equals(stale.uid).first();

    const signed = blankEntry(projectId, '2026-09-06', project.uid);
    signed.status = 'signed';
    const signedId = await saveEntry(signed);
    await saveEntry({ ...signed, id: signedId, status: 'draft' });
    const signedStayedRaised = (await db.entries.get(signedId)).status === 'signed';

    const checked = blankEntry(projectId, '2026-09-08', project.uid);
    checked.workDescription = 'loaded draft';
    const checkedId = await saveEntry(checked);
    const loadedChecked = await db.entries.get(checkedId);
    await db.entries.update(checkedId, {
      workDescription: 'revision received while editor was open',
      updatedAt: loadedChecked.updatedAt + 100,
    });
    const preserved = await saveEntryChecked(
      { ...loadedChecked, workDescription: 'visible editor revision' },
      loadedChecked.updatedAt,
    );
    const conflictRows = await db.entries.where({ projectId, date: '2026-09-08' }).toArray();
    const sequential = await saveEntryChecked(
      {
        ...(await db.entries.get(preserved.id)),
        workDescription: 'next visible editor revision',
      },
      preserved.updatedAt,
      preserved.syncRevision,
    );
    const conflictRowsAfterSequential = await db.entries
      .where({ projectId, date: '2026-09-08' })
      .toArray();
    const preservedCopy = conflictRowsAfterSequential.find((entry) => entry.uid !== preserved.uid);
    await deleteEntry(preservedCopy.id);

    const dateChanging = blankEntry(projectId, '2026-09-14', project.uid);
    dateChanging.workDescription = 'remote date revision';
    const dateChangingId = await saveEntry(dateChanging);
    const loadedDateChanging = await db.entries.get(dateChangingId);
    await db.entries.update(dateChangingId, {
      workDescription: 'stored revision on original date',
      updatedAt: loadedDateChanging.updatedAt + 100,
    });
    const crossDate = await saveEntryChecked(
      {
        ...loadedDateChanging,
        date: '2026-09-15',
        workDescription: 'visible revision on changed date',
      },
      loadedDateChanging.updatedAt,
    );
    const crossDateMain = await db.entries.get(crossDate.id);
    const crossDateRows = await db.entries
      .where('projectId')
      .equals(projectId)
      .filter((entry) => entry.syncConflictGroup === crossDateMain.syncConflictGroup)
      .toArray();
    const crossDateCopy = crossDateRows.find((entry) => entry.uid !== crossDate.uid);
    await deleteEntry(crossDateCopy.id);
    const crossDateResolved = await db.entries.get(crossDate.id);
    const resolvedSurvivor = await db.entries.where('uid').equals(preserved.uid).first();
    await restoreEntry(preservedCopy);
    const reopenedConflictRows = await db.entries
      .where({ projectId, date: '2026-09-08' })
      .filter((entry) => entry.deletedAt === undefined)
      .toArray();
    await deleteEntry(preservedCopy.id);

    const trashedForConflict = blankEntry(projectId, '2026-09-09', project.uid);
    const trashedForConflictId = await saveEntry(trashedForConflict);
    await deleteEntry(trashedForConflictId);
    await saveEntry(blankEntry(projectId, '2026-09-09', project.uid));
    const trashRestore = await Promise.allSettled([restoreFromTrash(trashedForConflictId)]);

    const doomedProjectId = await createProject({ name: 'doomed parent', address: '', company: '' });
    const doomedProject = await db.projects.get(doomedProjectId);
    const orphan = blankEntry(doomedProjectId, '2026-09-07', doomedProject.uid);
    const orphanId = await saveEntry(orphan);
    const staleOrphan = await db.entries.get(orphanId);
    await deleteProject(doomedProjectId);
    const missingParentWrite = await Promise.allSettled([saveEntry(staleOrphan)]);

    await setSetting('companyLogo', 'data:image/png;base64,AQ==');
    await setSetting('documentTheme', 'amber');
    await setSetting('signature.manager', 'manager-signature');
    await setSetting('signature.supervisor', 'supervisor-signature');
    await setSetting('device-only-test', 'keep-local');
    const futureEntry = blankEntry(projectId, '2026-09-04', project.uid);
    await saveEntry(futureEntry);
    const futureContact = blankContact();
    futureContact.name = 'future contact';
    await saveContact(futureContact);
    const json = await backupToJson();
    const parsed = JSON.parse(json);
    const future = Date.now() + 86400000;
    await db.tombstones.put({ uid: project.uid, table: 'projects', deletedAt: future });
    await setSetting('companyLogo', 'changed-after-backup');
    await restoreFromJson(json);
    const restoredProject = await db.projects.where('uid').equals(project.uid).first();
    const restoredSettings = Object.fromEntries((await db.settings.toArray()).map((s) => [s.key, s]));
    const restoredEntry = await db.entries.where('uid').equals(futureEntry.uid).first();
    const restoredContact = await db.contacts.where('uid').equals(futureContact.uid).first();
    const restoreStamp = restoredProject.updatedAt;
    await updateProject(restoredProject.id, { name: 'edited after future restore', address: '', company: '' });
    await saveEntry({ ...restoredEntry, workDescription: 'edited after future restore' });
    await saveContact({ ...restoredContact, notes: 'edited after future restore' });
    await setSetting('companyLogo', 'edited-after-future-restore');
    const monotonic = {
      project: (await db.projects.get(restoredProject.id)).updatedAt,
      entry: (await db.entries.get(restoredEntry.id)).updatedAt,
      contact: (await db.contacts.get(restoredContact.id)).updatedAt,
      setting: (await db.settings.get('companyLogo')).updatedAt,
    };

    await setSetting('companyLogo', 'must-be-cleared');
    await restoreFromJson(JSON.stringify({ ...parsed, settings: [] }));
    const exactEmptySettings = await db.settings.where('key').anyOf([
      'companyLogo', 'documentTheme', 'signature.manager', 'signature.supervisor',
    ]).toArray();

    return {
      concurrent: concurrent.map((item) => item.status === 'fulfilled' ? 'saved' : item.reason?.name),
      createRolledBack,
      liveSameDate,
      softDeletePreserved: typeof afterSoftDelete?.deletedAt === 'number',
      hardDeleteRejected: hardDeleteWrite[0].status === 'rejected' && hardDeleteWrite[0].reason?.name === 'EntryUnavailableError',
      hardDeleteStayedGone: afterHardDelete === undefined,
      signedStayedRaised,
      checkedConflictPreserved:
        preserved.conflictPreserved &&
        conflictRows.length === 2 &&
        conflictRows.every((entry) => entry.syncConflict) &&
        conflictRows.some((entry) => entry.workDescription === 'visible editor revision') &&
        conflictRows.some(
          (entry) => entry.workDescription === 'revision received while editor was open',
        ),
      checkedSequentialStayedSingle:
        !sequential.conflictPreserved && conflictRowsAfterSequential.length === 2,
      checkedConflictResolved: resolvedSurvivor.syncConflict === false,
      conflictUndoReopened:
        reopenedConflictRows.length === 2 &&
        reopenedConflictRows.every((entry) => entry.syncConflict === true),
      crossDateConflictPreserved:
        crossDate.conflictPreserved &&
        crossDateRows.length === 2 &&
        new Set(crossDateRows.map((entry) => entry.date)).size === 2 &&
        new Set(crossDateRows.map((entry) => entry.syncConflictGroup)).size === 1 &&
        crossDateRows.every((entry) => entry.syncConflict === true),
      crossDateConflictResolved: crossDateResolved.syncConflict === false,
      trashConflictTyped:
        trashRestore[0].status === 'rejected' &&
        trashRestore[0].reason?.name === 'EntryDateConflictError',
      missingParentRejected:
        missingParentWrite[0].status === 'rejected' && missingParentWrite[0].reason?.name === 'EntryUnavailableError',
      backedSettingKeys: (parsed.settings ?? []).map((s) => s.key).sort(),
      logoRestored: restoredSettings.companyLogo?.value === 'data:image/png;base64,AQ==',
      signaturesRestored:
        restoredSettings['signature.manager']?.value === 'manager-signature' &&
        restoredSettings['signature.supervisor']?.value === 'supervisor-signature',
      themeRestored: restoredSettings.documentTheme?.value === 'amber',
      deviceSettingPreserved: restoredSettings['device-only-test']?.value === 'keep-local',
      restoreBeatKnownFutureTombstone: (restoredProject?.updatedAt ?? 0) > future,
      monotonicAfterFutureRestore: Object.values(monotonic).every((stamp) => stamp > restoreStamp),
      exactEmptySettings: exactEmptySettings.length === 4 && exactEmptySettings.every((setting) => setting.value === null),
    };
  });
  await context.close();
  check(result.liveSameDate === 1, `duplicate live dates: ${JSON.stringify(result)}`);
  check(result.createRolledBack, `failed project create was not atomic: ${JSON.stringify(result)}`);
  check(result.concurrent.filter((v) => v === 'saved').length === 1, `date conflict not atomic: ${JSON.stringify(result)}`);
  check(result.softDeletePreserved, `stale save resurrected trash: ${JSON.stringify(result)}`);
  check(result.hardDeleteRejected && result.hardDeleteStayedGone, `stale save resurrected purge: ${JSON.stringify(result)}`);
  check(result.signedStayedRaised, `stale save lowered signed status: ${JSON.stringify(result)}`);
  check(result.checkedConflictPreserved, `checked save discarded a revision: ${JSON.stringify(result)}`);
  check(result.checkedSequentialStayedSingle, `checked save duplicated a sequential edit: ${JSON.stringify(result)}`);
  check(result.checkedConflictResolved, `conflict survivor stayed marked: ${JSON.stringify(result)}`);
  check(result.conflictUndoReopened, `conflict undo was not restored visibly: ${JSON.stringify(result)}`);
  check(result.crossDateConflictPreserved, `cross-date revisions were not linked: ${JSON.stringify(result)}`);
  check(result.crossDateConflictResolved, `cross-date conflict did not resolve: ${JSON.stringify(result)}`);
  check(result.trashConflictTyped, `trash conflict was not typed: ${JSON.stringify(result)}`);
  check(result.missingParentRejected, `stale save recreated entry under deleted project: ${JSON.stringify(result)}`);
  check(result.backedSettingKeys.length === 4, `backup settings incomplete: ${JSON.stringify(result)}`);
  check(result.logoRestored && result.signaturesRestored && result.themeRestored, `settings restore failed: ${JSON.stringify(result)}`);
  check(result.deviceSettingPreserved, `restore overwrote device setting: ${JSON.stringify(result)}`);
  check(result.restoreBeatKnownFutureTombstone, `restore stamp lost to known future tombstone: ${JSON.stringify(result)}`);
  check(result.monotonicAfterFutureRestore, `post-restore write moved backwards: ${JSON.stringify(result)}`);
  check(result.exactEmptySettings, `new-format empty settings were not restored exactly: ${JSON.stringify(result)}`);
  return result;
}

async function syncConflictAndMetadataCheck() {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('yoman-photos-bytes', 'test'));
  const page = await context.newPage();
  await page.goto(`${base}/favicon.svg`);
  const result = await page.evaluate(async () => {
    const dbmod = await import('/src/db.ts');
    const sync = await import('/src/sync/store.ts');
    const client = await import('/src/sync/client.ts');
    const protocol = await import('/src/sync/protocol.ts');
    const pending = await import('/src/lib/pendingWrites.ts');
    const { db, blankEntry, createProject, deleteEntry, saveEntry } = dbmod;
    await db.open();
    const projectId = await createProject({ name: 'sync conflicts', address: '', company: '' });
    const project = await db.projects.get(projectId);
    const local = blankEntry(projectId, '2026-09-11', project.uid);
    local.workDescription = 'local independent page';
    await saveEntry(local);
    const stored = await db.entries.where('uid').equals(local.uid).first();

    const incoming = {
      uid: 'remote-independent-entry',
      projectUid: project.uid,
      date: stored.date,
      weather: '',
      management: [],
      contractors: [],
      equipment: [],
      workDescription: 'remote independent page',
      casting: stored.casting,
      supervisorNotes: '',
      receivedToday: '',
      supervisorSignature: '',
      managerSignature: '',
      photos: [],
      status: 'draft',
      createdAt: stored.createdAt + 1,
      updatedAt: stored.updatedAt + 100,
    };
    const applied = await sync.applyPayload({
      projects: [],
      entries: [incoming],
      contacts: [{
        uid: 'remote-contact', name: 'synthetic', trade: '', phone: '', projects: '', notes: '',
        createdAt: 1, updatedAt: stored.updatedAt + 101,
      }],
      presets: [{
        kind: 'trade', value: 'remote preset', uses: 2, updatedAt: stored.updatedAt + 102,
      }],
      settings: [{
        key: 'documentTheme', value: 'sky', updatedAt: stored.updatedAt + 103,
      }],
      tombstones: [{
        uid: 'already-gone-entry', table: 'entries', deletedAt: stored.updatedAt + 104,
      }],
    });
    const rows = await db.entries.where({ projectId, date: stored.date }).toArray();
    const contents = rows.map((entry) => entry.workDescription).sort();
    const marked = rows.every((entry) => entry.syncConflict === true);
    await deleteEntry(rows.find((entry) => entry.uid === incoming.uid).id);
    const survivor = await db.entries.where('uid').equals(local.uid).first();

    const hostDraft = blankEntry(projectId, '2026-09-13', project.uid);
    hostDraft.workDescription = 'pending on hosting Mac';
    const unregister = pending.registerPendingWriteFlusher(() => saveEntry(hostDraft));
    const hostAnswer = await client.answerExchange({
      manifest: {
        version: protocol.SYNC_PROTOCOL_VERSION,
        deviceName: 'synthetic phone',
        projects: [], entries: [], contacts: [], presets: [], tombstones: [], settings: [],
      },
      payload: { projects: [], entries: [], contacts: [], presets: [], settings: [], tombstones: [] },
    });
    unregister();
    return {
      applied,
      rows: rows.length,
      contents,
      marked,
      grouped: new Set(rows.map((entry) => entry.syncConflictGroup)).size === 1,
      survivorCleared: survivor.syncConflict === false,
      hostPendingFlushed:
        hostAnswer.manifest?.entries.some((stamp) => stamp.uid === hostDraft.uid) === true,
    };
  });
  await context.close();
  check(result.rows === 2, `sync date conflict dropped a page: ${JSON.stringify(result)}`);
  check(
    result.contents.join('|') === 'local independent page|remote independent page',
    `sync date conflict changed page data: ${JSON.stringify(result)}`,
  );
  check(result.marked, `sync date conflict was not surfaced: ${JSON.stringify(result)}`);
  check(result.grouped, `sync date conflict was not grouped: ${JSON.stringify(result)}`);
  check(result.survivorCleared, `resolved sync conflict stayed marked: ${JSON.stringify(result)}`);
  check(result.hostPendingFlushed, `hosting sync omitted a pending editor: ${JSON.stringify(result)}`);
  check(
    result.applied.entries === 1 &&
      result.applied.contacts === 1 &&
      result.applied.presets === 1 &&
      result.applied.settings === 1 &&
      result.applied.tombstones === 1 &&
      result.applied.conflicts === 1,
    `sync metadata outcomes are incomplete: ${JSON.stringify(result)}`,
  );
  return result;
}

async function backupFreshnessCheck() {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('yoman-photos-bytes', 'test'));
  const page = await context.newPage();
  await page.goto(`${base}/favicon.svg`);
  const result = await page.evaluate(async () => {
    const writes = [];
    let rejectWrite = false;
    window.yoman = {
      autoBackup: async (_name, bytes) => {
        if (rejectWrite) return { saved: false, error: 'synthetic write refusal' };
        writes.push(JSON.parse(new TextDecoder().decode(bytes)));
        return { saved: true };
      },
    };
    const dbmod = await import('/src/db.ts');
    const pending = await import('/src/lib/pendingWrites.ts');
    const auto = await import('/src/lib/autoBackup.ts');
    const {
      db, blankContact, blankEntry, createProject, updateProject, setSetting, addPreset,
      deletePreset, purgeEntry, saveContact, saveEntry,
    } = dbmod;
    await db.open();
    await db.transaction(
      'rw',
      [db.projects, db.entries, db.contacts, db.presets, db.settings, db.tombstones],
      async () => {
        await Promise.all([
          db.projects.clear(), db.entries.clear(), db.contacts.clear(), db.presets.clear(),
          db.settings.clear(), db.tombstones.clear(),
        ]);
      },
    );
    localStorage.removeItem(auto.LAST_BACKUP_KEY);
    localStorage.removeItem(auto.LAST_BACKUP_STATE_KEY);

    const projectId = await createProject({ name: 'before', address: '', company: '' });
    const project = await db.projects.get(projectId);
    let pendingDraft = blankEntry(projectId, '2026-09-10', project.uid);
    pendingDraft.workDescription = 'visible before debounce';
    let needsFlush = true;
    const unregister = pending.registerPendingWriteFlusher(async () => {
      if (!needsFlush) return;
      needsFlush = false;
      await saveEntry(pendingDraft);
    });
    const first = await auto.backupNow({ force: true });
    unregister();
    const pendingWasIncluded = writes[0]?.entries?.[0]?.workDescription === 'visible before debounce';

    localStorage.setItem(auto.LAST_BACKUP_KEY, '123');
    const beforeSkip = writes.length;
    const skipped = await auto.backupNow();
    const skipKeptRealAge =
      writes.length === beforeSkip && localStorage.getItem(auto.LAST_BACKUP_KEY) === '123';

    await updateProject(projectId, { name: 'after', address: '', company: '' });
    await auto.backupNow();
    const projectOnlyWritten = writes.at(-1)?.projects?.[0]?.name === 'after';

    await setSetting('documentTheme', 'olive');
    const beforeSetting = writes.length;
    await auto.backupNow();
    const settingOnlyWritten =
      writes.length === beforeSetting + 1 &&
      writes.at(-1)?.settings?.some((setting) => setting.key === 'documentTheme');

    await addPreset('trade', 'synthetic trade');
    const beforePreset = writes.length;
    await auto.backupNow();
    const presetOnlyWritten = writes.length === beforePreset + 1;
    const preset = await db.presets.where({ kind: 'trade', value: 'synthetic trade' }).first();
    await deletePreset(preset.id);
    const beforePresetDelete = writes.length;
    await auto.backupNow();
    const presetDeletionWritten = writes.length === beforePresetDelete + 1;

    const doomed = await db.entries.where('date').equals('2026-09-10').first();
    await purgeEntry(doomed.id);
    const beforeDeletion = writes.length;
    await auto.backupNow();
    const permanentDeletionWritten =
      writes.length === beforeDeletion + 1 && writes.at(-1)?.entries?.length === 0;

    const contact = blankContact();
    contact.name = 'synthetic contact';
    await saveContact(contact);
    localStorage.setItem(auto.LAST_BACKUP_KEY, '321');
    rejectWrite = true;
    const beforeWriteFailure = writes.length;
    const refused = await auto.backupNow();
    const failedWriteKeptRealAge =
      refused === null &&
      writes.length === beforeWriteFailure &&
      localStorage.getItem(auto.LAST_BACKUP_KEY) === '321';
    rejectWrite = false;
    await auto.backupNow();
    const contactOnlyRetried =
      writes.length === beforeWriteFailure + 1 && writes.at(-1)?.contacts?.length === 1;

    const failing = pending.registerPendingWriteFlusher(async () => {
      throw new Error('synthetic pending write failure');
    });
    const beforeFailedFlush = writes.length;
    const failed = await auto.backupNow({ force: true });
    failing();

    return {
      first,
      skipped,
      pendingWasIncluded,
      skipKeptRealAge,
      projectOnlyWritten,
      settingOnlyWritten,
      presetOnlyWritten,
      presetDeletionWritten,
      permanentDeletionWritten,
      failedWriteKeptRealAge,
      contactOnlyRetried,
      failedFlushDidNotWrite: failed === null && writes.length === beforeFailedFlush,
      writes: writes.length,
    };
  });
  await context.close();
  check(result.first === 'mac', `forced synthetic backup failed: ${JSON.stringify(result)}`);
  check(result.skipped === 'mac', `unchanged synthetic backup result failed: ${JSON.stringify(result)}`);
  check(result.pendingWasIncluded, `pending editor write missing from backup: ${JSON.stringify(result)}`);
  check(result.skipKeptRealAge, `skipped backup advanced freshness: ${JSON.stringify(result)}`);
  check(result.projectOnlyWritten, `project-only change skipped: ${JSON.stringify(result)}`);
  check(result.settingOnlyWritten, `setting-only change skipped: ${JSON.stringify(result)}`);
  check(result.presetOnlyWritten, `preset-only change skipped: ${JSON.stringify(result)}`);
  check(result.presetDeletionWritten, `preset deletion skipped: ${JSON.stringify(result)}`);
  check(result.permanentDeletionWritten, `permanent deletion skipped: ${JSON.stringify(result)}`);
  check(result.failedWriteKeptRealAge, `failed file write advanced freshness: ${JSON.stringify(result)}`);
  check(result.contactOnlyRetried, `contact-only change was not retried: ${JSON.stringify(result)}`);
  check(result.failedFlushDidNotWrite, `failed pending flush wrote a stale copy: ${JSON.stringify(result)}`);
  return result;
}

async function visibleEditorBackupCheck() {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(() => localStorage.setItem('yoman-photos-bytes', 'test'));
  const page = await context.newPage();
  await page.goto(`${base}/#/projects`);
  await page.evaluate(async () => {
    const { db, createProject, setSetting, ACTIVE_PROJECT_KEY } = await import('/src/db.ts');
    await db.open();
    const id = await createProject({ name: 'visible backup', address: '', company: '' });
    await setSetting(ACTIVE_PROJECT_KEY, id);
  });
  await page.goto(`${base}/#/entry/new?date=2026-09-12`);
  await page.locator('#section-work .card__toggle').click();
  await page.locator('#section-work textarea').fill('VISIBLE BUT NOT YET AUTOSAVED');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.topbar__icon--backup').click();
  const download = await downloadPromise;
  const path = await download.path();
  const backup = JSON.parse(await readFile(path, 'utf8'));
  await context.close();
  const result = {
    entries: backup.entries?.length ?? 0,
    workDescription: backup.entries?.[0]?.workDescription ?? '',
  };
  check(
    result.entries === 1 && result.workDescription === 'VISIBLE BUT NOT YET AUTOSAVED',
    `app-bar backup omitted the visible editor revision: ${JSON.stringify(result)}`,
  );
  return result;
}

async function migrationRaceCheck() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/favicon.svg`);
  const result = await page.evaluate(async () => {
    localStorage.removeItem('yoman-photos-bytes');
    const dbmod = await import('/src/db.ts?migration-race-check');
    const photos = await import('/src/lib/photoData.ts?migration-race-check');
    const { db, blankEntry, createProject } = dbmod;
    await db.open();
    const projectId = await createProject({ name: 'migration', address: '', company: '' });
    const project = await db.projects.get(projectId);
    const legacy = {
      id: 'legacy', caption: 'old caption', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
      width: 1, height: 1, takenAt: 1,
    };
    const entry = blankEntry(projectId, '2026-09-02', project.uid);
    entry.photos = [legacy];
    entry.workDescription = 'old text';
    const id = await db.entries.add(entry);

    const original = Blob.prototype.arrayBuffer;
    let release;
    let entered;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { entered = resolve; });
    Blob.prototype.arrayBuffer = async function () {
      entered();
      await gate;
      return original.call(this);
    };
    try {
      const migration = photos.rewritePhotosAsBytes();
      await started;
      const current = await db.entries.get(id);
      await db.entries.update(id, {
        workDescription: 'new text while converting',
        updatedAt: current.updatedAt + 1000,
        photos: [
          { ...current.photos[0], caption: 'new caption while converting' },
          { id: 'new-photo', caption: 'new photo', bytes: new Uint8Array([9, 8, 7]), width: 1, height: 1, takenAt: 2 },
        ],
      });
      release();
      await migration;
    } finally {
      Blob.prototype.arrayBuffer = original;
    }
    const saved = await db.entries.get(id);
    return {
      text: saved.workDescription,
      ids: saved.photos.map((p) => p.id),
      caption: saved.photos[0].caption,
      legacyBecameBytes: saved.photos[0].bytes instanceof Uint8Array && saved.photos[0].bytes.length === 3,
      legacyBlobRemoved: saved.photos[0].blob === undefined,
    };
  });
  await context.close();
  check(result.text === 'new text while converting', `migration overwrote text: ${JSON.stringify(result)}`);
  check(result.ids.join(',') === 'legacy,new-photo', `migration overwrote photo list: ${JSON.stringify(result)}`);
  check(result.caption === 'new caption while converting', `migration overwrote caption: ${JSON.stringify(result)}`);
  check(result.legacyBecameBytes && result.legacyBlobRemoved, `migration failed conversion: ${JSON.stringify(result)}`);
  return result;
}

async function editorRouteExitCheck() {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('yoman-photos-bytes', 'test'));
  const page = await context.newPage();
  await page.goto(`${base}/#/projects`);
  await page.evaluate(async () => {
    const { db, createProject, setSetting, ACTIVE_PROJECT_KEY } = await import('/src/db.ts');
    await db.open();
    const id = await createProject({ name: 'route-exit', address: '', company: '' });
    await setSetting(ACTIVE_PROJECT_KEY, id);
  });
  await page.goto(`${base}/#/entry/new?date=2026-09-03`);
  await page.locator('#section-work .card__toggle').click();
  await page.locator('#section-work textarea').fill('must survive immediate navigation');
  await page.locator('nav.nav button').first().click();
  await page.waitForFunction(() => location.hash === '#/');
  await page.waitForTimeout(300);
  const rows = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    return db.entries.where('date').equals('2026-09-03').toArray();
  });
  await context.close();
  check(rows.length === 1 && rows[0].workDescription === 'must survive immediate navigation', `route exit lost edit: ${JSON.stringify(rows)}`);
  return { rows: rows.length, text: rows[0].workDescription };
}

async function editorDelayedReopenCheck() {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('yoman-photos-bytes', 'test'));
  const page = await context.newPage();
  await page.goto(`${base}/#/projects`);
  const id = await page.evaluate(async () => {
    const { db, blankEntry, createProject, setSetting, ACTIVE_PROJECT_KEY } = await import('/src/db.ts');
    const { legacyEntryRevision } = await import('/src/sync/revision.ts');
    await db.open();
    const projectId = await createProject({ name: 'delayed-reopen', address: '', company: '' });
    await setSetting(ACTIVE_PROJECT_KEY, projectId);
    const project = await db.projects.get(projectId);
    const entry = blankEntry(projectId, '2026-09-05', project.uid);
    entry.photos = [{
      id: 'slow', caption: '', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
      width: 1, height: 1, takenAt: 1,
    }];
    // Production rows receive this in schema v8. The fixture uses a direct add
    // to retain its Blob for the delayed conversion race.
    entry.syncRevision = legacyEntryRevision(entry);
    return db.entries.add(entry);
  });
  await page.goto(`${base}/#/entry/${id}`);
  await page.locator('#section-work .card__toggle').click();
  await page.evaluate(() => {
    const original = Blob.prototype.arrayBuffer;
    let release;
    let entered;
    const gate = new Promise((resolve) => { release = resolve; });
    window.__releaseSlowBlob = release;
    window.__slowBlobEntered = new Promise((resolve) => { entered = resolve; });
    Blob.prototype.arrayBuffer = async function () {
      entered();
      await gate;
      return original.call(this);
    };
  });
  await page.locator('#section-work textarea').fill('old editor final revision');
  await page.evaluate(() => window.__slowBlobEntered);
  await page.locator('nav.nav button').first().click();
  await page.waitForFunction(() => location.hash === '#/');
  await page.locator('#section-work').waitFor({ state: 'detached' });
  await page.evaluate((entryId) => { location.hash = `#/entry/${entryId}`; }, id);
  await page.evaluate(() => window.__releaseSlowBlob());
  const workToggle = page.locator('#section-work .card__toggle');
  await workToggle.waitFor();
  if ((await workToggle.getAttribute('aria-expanded')) !== 'true') await workToggle.click();
  const reopened = await page.locator('#section-work textarea').inputValue();
  await page.locator('#section-work textarea').fill('new editor revision');
  await page.waitForTimeout(1500);
  const stored = await page.evaluate(async (entryId) => {
    const { db } = await import('/src/db.ts');
    return db.entries.get(entryId);
  }, id);
  await context.close();
  check(reopened === 'old editor final revision', `reopen read before exit save: ${reopened}`);
  check(stored.workDescription === 'new editor revision', `old editor overwrote reopened edit: ${stored.workDescription}`);
  return { reopened, stored: stored.workDescription };
}

async function v6UpgradeCheck() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/favicon.svg`);
  const result = await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('yoman-avoda', 60);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const raw = request.result;
        const make = (name, keyPath, autoIncrement = false) => raw.createObjectStore(name, { keyPath, autoIncrement });
        const projects = make('projects', 'id', true);
        projects.createIndex('uid', 'uid', { unique: true });
        projects.createIndex('name', 'name');
        projects.createIndex('archived', 'archived');
        projects.createIndex('createdAt', 'createdAt');
        projects.createIndex('[uid+createdAt]', ['uid', 'createdAt']);
        const entries = make('entries', 'id', true);
        entries.createIndex('uid', 'uid', { unique: true });
        entries.createIndex('projectUid', 'projectUid'); entries.createIndex('projectId', 'projectId');
        entries.createIndex('date', 'date'); entries.createIndex('[projectId+date]', ['projectId', 'date']);
        entries.createIndex('status', 'status'); entries.createIndex('updatedAt', 'updatedAt');
        entries.createIndex('[uid+updatedAt]', ['uid', 'updatedAt']);
        const contacts = make('contacts', 'id', true);
        contacts.createIndex('uid', 'uid', { unique: true }); contacts.createIndex('name', 'name');
        contacts.createIndex('trade', 'trade'); contacts.createIndex('updatedAt', 'updatedAt');
        contacts.createIndex('[uid+updatedAt]', ['uid', 'updatedAt']);
        const presets = make('presets', 'id', true);
        presets.createIndex('kind', 'kind'); presets.createIndex('[kind+value]', ['kind', 'value']); presets.createIndex('uses', 'uses');
        make('settings', 'key');
        const tombstones = make('tombstones', 'uid');
        tombstones.createIndex('table', 'table'); tombstones.createIndex('deletedAt', 'deletedAt');
        const logs = make('logs', 'id', true); logs.createIndex('at', 'at'); logs.createIndex('level', 'level');
      };
      request.onsuccess = () => {
        const raw = request.result;
        const tx = raw.transaction(['projects', 'entries'], 'readwrite');
        const addProject = tx.objectStore('projects').add({
          uid: 'legacy-project', name: 'legacy', address: '', company: '', archived: false,
          createdAt: 123456,
        });
        addProject.onsuccess = () => {
          tx.objectStore('entries').add({
            uid: 'legacy-entry', projectUid: 'legacy-project', projectId: addProject.result,
            date: '2026-01-01', weather: '', management: [], contractors: [], equipment: [],
            workDescription: 'legacy causal seed', casting: {
              description: '', sizeQty: '', pump: '', concreteType: '', concreteQty: '',
              notes: '', notesConcreteType: '',
            },
            supervisorNotes: '', supervisorSignature: '', managerSignature: '', photos: [],
            status: 'draft', createdAt: 123456, updatedAt: 123456,
          });
        };
        tx.oncomplete = () => { raw.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    const { db } = await import('/src/db.ts?v6-upgrade-check');
    await db.open();
    const project = await db.projects.where('uid').equals('legacy-project').first();
    const entry = await db.entries.where('uid').equals('legacy-entry').first();
    return {
      version: db.verno,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      indexes: db.projects.schema.indexes.map((index) => index.name),
      entryIndexes: db.entries.schema.indexes.map((index) => index.name),
      entryRevision: entry.syncRevision,
    };
  });
  await context.close();
  check(result.version === 8, `upgrade version wrong: ${JSON.stringify(result)}`);
  check(result.updatedAt === result.createdAt, `project stamp not backfilled: ${JSON.stringify(result)}`);
  check(result.indexes.includes('[uid+updatedAt]'), `new manifest index absent: ${JSON.stringify(result)}`);
  check(
    result.entryIndexes.includes('[uid+updatedAt+syncRevision]') && !!result.entryRevision,
    `causal manifest migration absent: ${JSON.stringify(result)}`,
  );
  return result;
}

try {
  const results = {
    direct: await directStorageChecks(),
    backups: await backupFreshnessCheck(),
    visibleBackup: await visibleEditorBackupCheck(),
    syncConflict: await syncConflictAndMetadataCheck(),
    migration: await migrationRaceCheck(),
    routeExit: await editorRouteExitCheck(),
    delayedReopen: await editorDelayedReopenCheck(),
    upgrade: await v6UpgradeCheck(),
  };
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
