/**
 * Causal entry-sync regressions in isolated Chromium contexts.
 * Each context is an independent synthetic device/database; no installed diary
 * profile is opened. Start Vite and set YOMAN_BASE_URL if it is not on :5173.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.YOMAN_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.YOMAN_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });

function check(value, message) {
  if (!value) throw new Error(message);
}

async function makeDevice(name) {
  const context = await browser.newContext();
  await context.addInitScript((device) => {
    localStorage.setItem('yoman-photos-bytes', 'test');
    localStorage.setItem('yoman-entry-revision-device', device);
  }, name);
  const page = await context.newPage();
  await page.goto(`${base}/favicon.svg`);
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    await db.open();
    await db.transaction(
      'rw',
      [db.projects, db.entries, db.contacts, db.presets, db.settings, db.tombstones],
      async () => Promise.all([
        db.projects.clear(), db.entries.clear(), db.contacts.clear(), db.presets.clear(),
        db.settings.clear(), db.tombstones.clear(),
      ]),
    );
  });
  return { name, context, page };
}

async function closeDevices(...devices) {
  await Promise.all(devices.map((device) => device.context.close()));
}

async function createBase(device, options = {}) {
  return device.page.evaluate(async ({ date, description, photoBytes }) => {
    const { db, blankEntry, createProject, saveEntry } = await import('/src/db.ts');
    const projectId = await createProject({ name: 'causal', address: '', company: '' });
    const project = await db.projects.get(projectId);
    const entry = blankEntry(projectId, date, project.uid);
    entry.workDescription = description;
    if (photoBytes) {
      entry.photos = [{
        id: 'shared-photo', caption: 'same', width: 10, height: 10, takenAt: 1,
        bytes: new Uint8Array(photoBytes),
      }];
    }
    await saveEntry(entry);
    return { projectUid: project.uid, entryUid: entry.uid };
  }, {
    date: options.date ?? '2026-10-01',
    description: options.description ?? 'base',
    photoBytes: options.photoBytes ?? null,
  });
}

async function manifest(device) {
  return device.page.evaluate(async (name) => {
    const { buildManifest } = await import('/src/sync/store.ts');
    return buildManifest(name);
  }, device.name);
}

async function request(device, ours, theirs) {
  return device.page.evaluate(async ({ mine, other }) => {
    const { whatToRequest } = await import('/src/sync/protocol.ts');
    return whatToRequest(mine, other);
  }, { mine: ours, other: theirs });
}

async function payload(device, wanted) {
  return device.page.evaluate(async (selection) => {
    const { collectPayload } = await import('/src/sync/store.ts');
    return collectPayload(selection);
  }, wanted);
}

async function apply(device, incoming) {
  return device.page.evaluate(async (wire) => {
    const { applyPayload } = await import('/src/sync/store.ts');
    return applyPayload(wire);
  }, incoming);
}

/** One symmetric manifest→request→payload→merge round from pre-merge snapshots. */
async function syncRound(left, right, reverse = false) {
  const [leftManifest, rightManifest] = await Promise.all([manifest(left), manifest(right)]);
  const [leftWants, rightWants] = await Promise.all([
    request(left, leftManifest, rightManifest),
    request(right, rightManifest, leftManifest),
  ]);
  const [forLeft, forRight] = await Promise.all([
    payload(right, leftWants),
    payload(left, rightWants),
  ]);
  const runLeft = () => apply(left, forLeft);
  const runRight = () => apply(right, forRight);
  const outcomes = reverse
    ? [await runRight(), await runLeft()]
    : [await runLeft(), await runRight()];
  return {
    requestedEntries: leftWants.entries.length + rightWants.entries.length,
    outcomes,
  };
}

async function settle(devices, rounds = 5) {
  for (let pass = 0; pass < rounds; pass += 1) {
    for (let index = 0; index < devices.length; index += 1) {
      await syncRound(
        devices[index],
        devices[(index + 1) % devices.length],
        (pass + index) % 2 === 1,
      );
    }
  }
}

async function state(device) {
  return device.page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    const rows = await db.entries.toArray();
    return rows
      .map((entry) => ({
        id: entry.id,
        uid: entry.uid,
        date: entry.date,
        description: entry.workDescription,
        weather: entry.weather,
        bytes: entry.photos[0]?.bytes ? [...entry.photos[0].bytes] : [],
        updatedAt: entry.updatedAt,
        revision: entry.syncRevision,
        conflict: entry.syncConflict === true,
        conflictKind: entry.syncConflictKind ?? '',
        group: entry.syncConflictGroup ?? '',
        root: entry.syncConflictRoot ?? '',
        deleted: entry.deletedAt !== undefined,
      }))
      .sort((a, b) => a.uid.localeCompare(b.uid));
  });
}

async function entryTombstoneCount(device) {
  return device.page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    return db.tombstones.where('table').equals('entries').count();
  });
}

async function edit(device, uid, changes, now) {
  return device.page.evaluate(async ({ entryUid, patch, fixedNow }) => {
    const { db, saveEntry } = await import('/src/db.ts');
    const entry = await db.entries.where('uid').equals(entryUid).first();
    const realNow = Date.now;
    Date.now = () => fixedNow;
    try {
      await saveEntry({
        ...entry,
        ...patch,
        photos: patch.photoBytes
          ? entry.photos.map((photo) => ({ ...photo, bytes: new Uint8Array(patch.photoBytes) }))
          : entry.photos,
      });
    } finally {
      Date.now = realNow;
    }
  }, { entryUid: uid, patch: changes, fixedNow: now });
}

async function legacyEdit(device, uid, description, now) {
  return device.page.evaluate(async ({ entryUid, text, fixedNow }) => {
    const { db } = await import('/src/db.ts');
    const { legacyEntryRevision } = await import('/src/sync/revision.ts');
    const entry = await db.entries.where('uid').equals(entryUid).first();
    const changed = {
      ...entry,
      workDescription: text,
      updatedAt: fixedNow,
      syncRevision: undefined,
    };
    changed.syncRevision = legacyEntryRevision(changed);
    await db.entries.put(changed);
  }, { entryUid: uid, text: description, fixedNow: now });
}

async function seedFrom(source, target) {
  await syncRound(source, target);
  await syncRound(source, target, true);
}

const canonical = (rows) => rows.map((row) => ({
  uid: row.uid,
  date: row.date,
  description: row.description,
  weather: row.weather,
  bytes: row.bytes,
  revision: row.revision,
  conflict: row.conflict,
  conflictKind: row.conflictKind,
  group: row.group,
  root: row.root,
  deleted: row.deleted,
}));

async function sequentialCheck() {
  const a = await makeDevice('sequential-a');
  const b = await makeDevice('sequential-b');
  try {
    const ids = await createBase(a);
    await seedFrom(a, b);
    await edit(a, ids.entryUid, { workDescription: 'sequential update' }, 9_000_000_000_000);
    await settle([a, b], 2);
    const [left, right] = await Promise.all([state(a), state(b)]);
    check(left.length === 1 && right.length === 1, `sequential edit forked: ${JSON.stringify({ left, right })}`);
    check(left[0].description === 'sequential update', `sequential content lost: ${JSON.stringify(left)}`);
    check(JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)), 'sequential peers diverged');
    check(!left[0].conflict, 'sequential edit marked conflict');
    return { rows: left.length, revision: left[0].revision };
  } finally {
    await closeDevices(a, b);
  }
}

async function concurrentCheck({ skew = false, differentFields = false } = {}) {
  const a = await makeDevice(`concurrent-a-${skew}-${differentFields}`);
  const b = await makeDevice(`concurrent-b-${skew}-${differentFields}`);
  try {
    const ids = await createBase(a);
    await seedFrom(a, b);
    const same = 9_000_000_100_000;
    await Promise.all([
      edit(a, ids.entryUid, { workDescription: 'branch A' }, same),
      edit(
        b,
        ids.entryUid,
        differentFields ? { weather: 'branch B weather' } : { workDescription: 'branch B' },
        skew ? same + 5_000_000 : same,
      ),
    ]);
    await settle([a, b], 4);
    const [left, right] = await Promise.all([state(a), state(b)]);
    const leftLive = left.filter((row) => !row.deleted);
    const rightLive = right.filter((row) => !row.deleted);
    check(leftLive.length === 2 && rightLive.length === 2, `concurrent branch lost: ${JSON.stringify({ left, right })}`);
    check(
      leftLive.every(
        (row) => row.conflict && row.conflictKind === 'revision' && row.group && row.root,
      ),
      'concurrent branches not surfaced/grouped',
    );
    check(JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)), `concurrent peers diverged: ${JSON.stringify({ left, right })}`);
    const before = JSON.stringify(canonical(left));
    await settle([b, a], 4);
    const stable = await state(a);
    check(JSON.stringify(canonical(stable)) === before, `repeat/reverse sync grew or changed branches: ${JSON.stringify(stable)}`);
    return { rows: stable.length, uids: stable.map((row) => row.uid), equalStamp: !skew };
  } finally {
    await closeDevices(a, b);
  }
}

async function equalContentCheck() {
  const a = await makeDevice('equal-content-a');
  const b = await makeDevice('equal-content-b');
  try {
    const ids = await createBase(a);
    await seedFrom(a, b);
    const now = 9_000_000_200_000;
    await Promise.all([
      edit(a, ids.entryUid, { workDescription: 'same edit' }, now),
      edit(b, ids.entryUid, { workDescription: 'same edit' }, now),
    ]);
    await settle([a, b], 3);
    const [left, right] = await Promise.all([state(a), state(b)]);
    check(left.length === 1 && right.length === 1, `equal content duplicated: ${JSON.stringify({ left, right })}`);
    check(!left[0].conflict && left[0].revision === right[0].revision, 'equal content clocks did not join');
    return { rows: left.length, revision: left[0].revision };
  } finally {
    await closeDevices(a, b);
  }
}

async function legacyConflictCheck() {
  const a = await makeDevice('legacy-a');
  const b = await makeDevice('legacy-b');
  try {
    const ids = await createBase(a);
    await seedFrom(a, b);
    const now = 9_000_000_250_000;
    await Promise.all([
      legacyEdit(a, ids.entryUid, 'legacy branch A', now),
      legacyEdit(b, ids.entryUid, 'legacy branch B', now),
    ]);
    await settle([a, b], 4);
    const [left, right] = await Promise.all([state(a), state(b)]);
    check(left.length === 2 && right.length === 2, `legacy branch lost: ${JSON.stringify({ left, right })}`);
    check(JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)), 'legacy peers did not converge');
    await settle([b, a], 3);
    const stable = await state(a);
    check(stable.length === 2, `legacy repeated sync grew branches: ${JSON.stringify(stable)}`);
    return { rows: stable.length, descriptions: stable.map((row) => row.description).sort() };
  } finally {
    await closeDevices(a, b);
  }
}

async function photoConflictCheck() {
  const a = await makeDevice('photo-a');
  const b = await makeDevice('photo-b');
  try {
    const ids = await createBase(a, { photoBytes: [1, 2, 3, 4] });
    await seedFrom(a, b);
    const now = 9_000_000_300_000;
    await Promise.all([
      edit(a, ids.entryUid, { photoBytes: [1, 2, 3, 5] }, now),
      edit(b, ids.entryUid, { photoBytes: [1, 2, 4, 4] }, now),
    ]);
    await settle([a, b], 4);
    const rows = (await state(a)).filter((row) => !row.deleted);
    check(rows.length === 2, `same-size photo branches merged: ${JSON.stringify(rows)}`);
    const bodies = rows.map((row) => row.bytes.join(',')).sort();
    check(bodies.join('|') === '1,2,3,5|1,2,4,4', `photo bytes lost: ${JSON.stringify(rows)}`);
    return { rows: rows.length, bodies };
  } finally {
    await closeDevices(a, b);
  }
}

async function threeDeviceCheck() {
  const a = await makeDevice('three-a');
  const b = await makeDevice('three-b');
  const c = await makeDevice('three-c');
  try {
    const ids = await createBase(a);
    await seedFrom(a, b);
    await seedFrom(a, c);
    const now = 9_000_000_400_000;
    await Promise.all([
      edit(a, ids.entryUid, { workDescription: 'three A' }, now),
      edit(b, ids.entryUid, { workDescription: 'three B' }, now + 1_000_000),
      edit(c, ids.entryUid, { workDescription: 'three C' }, now - 1_000_000),
    ]);
    await settle([a, b, c], 6);
    const states = await Promise.all([state(a), state(b), state(c)]);
    for (const rows of states) {
      check(rows.filter((row) => !row.deleted).length === 3, `three-device branch lost/grew: ${JSON.stringify(states)}`);
    }
    const expected = JSON.stringify(canonical(states[0]));
    check(states.every((rows) => JSON.stringify(canonical(rows)) === expected), 'three devices did not converge');
    await settle([c, b, a], 4);
    const stable = await state(c);
    check(JSON.stringify(canonical(stable)) === expected, 'three-device repeat sync was not idempotent');
    return { rows: stable.length, descriptions: stable.map((row) => row.description).sort() };
  } finally {
    await closeDevices(a, b, c);
  }
}

async function restoreAndTrashCheck() {
  const a = await makeDevice('restore-trash-a');
  const b = await makeDevice('restore-trash-b');
  try {
    const ids = await createBase(a);
    await seedFrom(a, b);
    const backup = await a.page.evaluate(async () => {
      const { backupToJson } = await import('/src/db.ts');
      return backupToJson();
    });
    await edit(a, ids.entryUid, { workDescription: 'after backup' }, 9_000_000_500_000);
    await settle([a, b], 2);
    await a.page.evaluate(async (json) => {
      const { restoreFromJson } = await import('/src/db.ts');
      await restoreFromJson(json);
    }, backup);
    await settle([a, b], 3);
    let [left, right] = await Promise.all([state(a), state(b)]);
    check(left.length === 1 && left[0].description === 'base', `restore did not dominate: ${JSON.stringify({ left, right })}`);
    check(JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)), 'restored revision did not converge');

    await b.page.evaluate(async (uid) => {
      const { db, deleteEntry, purgeEntry } = await import('/src/db.ts');
      const row = await db.entries.where('uid').equals(uid).first();
      await deleteEntry(row.id);
      await purgeEntry(row.id);
    }, ids.entryUid);
    await settle([b, a], 3);
    check(
      (await state(a)).filter((row) => !row.deleted).length === 0,
      'permanent deletion did not reach restore peer',
    );
    await a.page.evaluate(async (json) => {
      const { restoreFromJson } = await import('/src/db.ts');
      await restoreFromJson(json);
    }, backup);
    await settle([a, b], 3);
    [left, right] = await Promise.all([state(a), state(b)]);
    check(
      left.length === 1 && right.length === 1 && left[0].description === 'base',
      `restore did not causally beat entry tombstone: ${JSON.stringify({ left, right })}`,
    );
    check(
      (await entryTombstoneCount(a)) === 0 && (await entryTombstoneCount(b)) === 0,
      'restore left an obsolete entry tombstone',
    );

    await Promise.all([
      edit(a, ids.entryUid, { workDescription: 'trash branch A' }, 9_000_000_600_000),
      edit(b, ids.entryUid, { workDescription: 'trash branch B' }, 9_000_000_600_000),
    ]);
    await settle([a, b], 4);
    left = await state(a);
    const doomed = left.find((row) => row.description === 'trash branch B') ?? left[1];
    await a.page.evaluate(async (uid) => {
      const { db, deleteEntry } = await import('/src/db.ts');
      const row = await db.entries.where('uid').equals(uid).first();
      await deleteEntry(row.id);
    }, doomed.uid);
    await settle([a, b], 4);
    [left, right] = await Promise.all([state(a), state(b)]);
    const leftLive = left.filter((row) => !row.deleted);
    const rightLive = right.filter((row) => !row.deleted);
    check(leftLive.length === 1 && rightLive.length === 1, `trash did not resolve branches: ${JSON.stringify({ left, right })}`);
    check(!leftLive[0].conflict && !rightLive[0].conflict, 'trash survivor stayed marked');
    check(JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)), 'trash resolution did not converge');
    return { restored: leftLive[0].description, live: leftLive.length, total: left.length };
  } finally {
    await closeDevices(a, b);
  }
}

async function deleteVsEditCheck() {
  const a = await makeDevice('delete-edit-a');
  const b = await makeDevice('delete-edit-b');
  try {
    const ids = await createBase(a);
    await seedFrom(a, b);
    await edit(
      a,
      ids.entryUid,
      { workDescription: 'concurrent edit survives' },
      9_000_000_700_000,
    );
    await b.page.evaluate(async (uid) => {
      const { db, deleteEntry, purgeEntry } = await import('/src/db.ts');
      const row = await db.entries.where('uid').equals(uid).first();
      const realNow = Date.now;
      Date.now = () => 9_000_900_000_000;
      try {
        await deleteEntry(row.id);
        await purgeEntry(row.id);
      } finally {
        Date.now = realNow;
      }
    }, ids.entryUid);
    await settle([a, b], 4);
    let [left, right] = await Promise.all([state(a), state(b)]);
    check(
      left.filter((row) => !row.deleted).length === 1 &&
        right.filter((row) => !row.deleted).length === 1,
      `clock-skewed deletion erased concurrent edit: ${JSON.stringify({ left, right })}`,
    );
    check(
      left[0].conflictKind === 'deletion' && right[0].conflictKind === 'deletion',
      'delete/edit conflict was not surfaced with deletion semantics',
    );

    // Saving the surviving edit deliberately chooses Keep. Its new vector
    // joins the deletion head and dominates it without relying on the clock.
    await a.page.evaluate(async (uid) => {
      const { db, saveEntry } = await import('/src/db.ts');
      const row = await db.entries.where('uid').equals(uid).first();
      await saveEntry({ ...row, supervisorNotes: 'keep this branch' });
    }, ids.entryUid);
    await settle([a, b], 4);
    [left, right] = await Promise.all([state(a), state(b)]);
    check(
      left.length === 1 &&
        right.length === 1 &&
        !left[0].conflict &&
        !right[0].conflict &&
        !left[0].conflictKind &&
        !right[0].conflictKind,
      `keeping delete/edit branch did not converge: ${JSON.stringify({ left, right })}`,
    );
    check(
      (await entryTombstoneCount(a)) === 0 && (await entryTombstoneCount(b)) === 0,
      'explicit Keep left an obsolete entry tombstone',
    );

    // Deleting it again is causally after both branches and must now win even
    // with a clock value lower than the earlier remote tombstone.
    await b.page.evaluate(async (uid) => {
      const { db, deleteEntry, purgeEntry } = await import('/src/db.ts');
      const row = await db.entries.where('uid').equals(uid).first();
      const realNow = Date.now;
      Date.now = () => 1;
      try {
        await deleteEntry(row.id);
        await purgeEntry(row.id);
      } finally {
        Date.now = realNow;
      }
    }, ids.entryUid);
    await settle([b, a], 4);
    [left, right] = await Promise.all([state(a), state(b)]);
    check(
      left.filter((row) => !row.deleted).length === 0 &&
        right.filter((row) => !row.deleted).length === 0,
      `causally-later permanent deletion did not win: ${JSON.stringify({ left, right })}`,
    );
    return { concurrentEditKept: true, laterDeletionWon: true };
  } finally {
    await closeDevices(a, b);
  }
}

try {
  const results = {
    sequential: await sequentialCheck(),
    equalStampSameField: await concurrentCheck(),
    equalStampDifferentFields: await concurrentCheck({ differentFields: true }),
    skewedSameField: await concurrentCheck({ skew: true }),
    equalContent: await equalContentCheck(),
    legacy: await legacyConflictCheck(),
    sameSizePhotos: await photoConflictCheck(),
    threeDevices: await threeDeviceCheck(),
    restoreAndTrash: await restoreAndTrashCheck(),
    deleteVsEdit: await deleteVsEditCheck(),
  };
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
