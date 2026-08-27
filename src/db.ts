/**
 * Local-first storage. Everything lives in IndexedDB on this device — the app
 * works with no network at all on site. `backupToJson` / `restoreFromJson` are
 * the safety net, since there is no server copy.
 */
import Dexie, { type Table } from 'dexie';
import type {
  Contact,
  ContactDraft,
  DiaryEntry,
  Preset,
  PresetKind,
  Project,
  Tombstone,
} from './types';
import { emptyCasting } from './types';
// A value import, and safe to be one: `log.ts` reaches this module through a
// *dynamic* `import('../db')` and never a static one, so the two never form a
// cycle at load time. Importing the logger here is what makes the diary's own
// storage able to say what it did — which, until it could, made "the page I
// wrote yesterday is gone" unanswerable from the log.
import { logger, type LogEntry } from './lib/log';
import { uid as newUid } from './lib/id';
import {
  bytesToDataUrl,
  dataUrlToBytes,
  photoBytes,
  storablePhotos,
} from './lib/photoData';
import { isoDate } from './lib/dates';

/** Small key/value bag for app state that must outlive a reload. */
export interface Setting {
  key: string;
  value: unknown;
  /** Set for the few settings that sync between devices, e.g. the logo. */
  updatedAt?: number;
}

class YomanDb extends Dexie {
  projects!: Table<Project, number>;
  entries!: Table<DiaryEntry, number>;
  contacts!: Table<Contact, number>;
  presets!: Table<Preset, number>;
  settings!: Table<Setting, string>;

  tombstones!: Table<Tombstone, string>;
  logs!: Table<LogEntry, number>;

  constructor() {
    super('yoman-avoda');
    this.version(1).stores({
      projects: '++id, name, archived, createdAt',
      // [projectId+date] enforces one page per project per day.
      entries: '++id, projectId, date, [projectId+date], status, updatedAt',
      presets: '++id, kind, [kind+value], uses',
      settings: 'key',
    });

    // v2 adds the identities sync needs: a uid per record that is stable across
    // devices, and tombstones so a deletion travels instead of the record
    // simply reappearing from the other device.
    this.version(2)
      .stores({
        projects: '++id, &uid, name, archived, createdAt',
        entries: '++id, &uid, projectUid, projectId, date, [projectId+date], status, updatedAt',
        presets: '++id, kind, [kind+value], uses',
        settings: 'key',
        tombstones: '&uid, table, deletedAt',
      })
      .upgrade(async (tx) => {
        const projects = await tx.table('projects').toArray();
        const uidById = new Map<number, string>();
        for (const project of projects) {
          const uid = project.uid ?? newUid();
          uidById.set(project.id, uid);
          await tx.table('projects').update(project.id, { uid });
        }
        const entries = await tx.table('entries').toArray();
        for (const entry of entries) {
          await tx.table('entries').update(entry.id, {
            uid: entry.uid ?? newUid(),
            projectUid: entry.projectUid ?? uidById.get(entry.projectId) ?? '',
          });
        }
      });

    // v3 adds the device's own log. It is indexed by `at` because every use of
    // it is chronological: show the newest first, drop the oldest when full.
    // No upgrade step — a new table starts empty, and there is nothing to
    // backfill from a device that was not recording.
    this.version(3).stores({
      projects: '++id, &uid, name, archived, createdAt',
      entries: '++id, &uid, projectUid, projectId, date, [projectId+date], status, updatedAt',
      presets: '++id, kind, [kind+value], uses',
      settings: 'key',
      tombstones: '&uid, table, deletedAt',
      logs: '++id, at, level',
    });

    // v4 adds two compound indexes that exist purely so sync can build its
    // manifest from *index keys* instead of records.
    //
    // A manifest needs nothing but `uid` and `updatedAt`, but `entries.toArray()`
    // deserialises every row — including the photo Blobs, which are the entire
    // weight of the diary. On a phone with a few weeks of photos that read alone
    // took longer than the network transfer, and it happened twice per sync.
    // `orderBy('[uid+updatedAt]').keys()` never touches the record bodies.
    this.version(4).stores({
      projects: '++id, &uid, name, archived, createdAt, [uid+createdAt]',
      entries:
        '++id, &uid, projectUid, projectId, date, [projectId+date], status, updatedAt, [uid+updatedAt]',
      presets: '++id, kind, [kind+value], uses',
      settings: 'key',
      tombstones: '&uid, table, deletedAt',
      logs: '++id, at, level',
    });

    // v5 changes no schema — it backfills the rule that a page carrying a
    // מנ"ע signature is no longer a draft. Without this, pages signed before
    // the rule existed would sit as drafts until each was opened and saved
    // again, which is exactly the manual step the rule exists to remove.
    this.version(5)
      .stores({
        projects: '++id, &uid, name, archived, createdAt, [uid+createdAt]',
        entries:
          '++id, &uid, projectUid, projectId, date, [projectId+date], status, updatedAt, [uid+updatedAt]',
        presets: '++id, kind, [kind+value], uses',
        settings: 'key',
        tombstones: '&uid, table, deletedAt',
        logs: '++id, at, level',
      })
      .upgrade((tx) =>
        // `modify` streams the rows rather than loading them all, which matters
        // here: every record carries its photos.
        tx
          .table('entries')
          .toCollection()
          .modify((entry: DiaryEntry) => {
            if (entry.managerSignature?.trim()) entry.status = 'signed';
          }),
      );

    // v6 adds ספקים וקבלנים — the site's address book. It carries the same
    // `[uid+updatedAt]` index as the other synced tables, for the same reason:
    // a manifest is built from index keys and must never read the records.
    // No upgrade step; a new table starts empty and there is nothing to
    // backfill it from.
    this.version(6).stores({
      projects: '++id, &uid, name, archived, createdAt, [uid+createdAt]',
      entries:
        '++id, &uid, projectUid, projectId, date, [projectId+date], status, updatedAt, [uid+updatedAt]',
      contacts: '++id, &uid, name, trade, updatedAt, [uid+updatedAt]',
      presets: '++id, kind, [kind+value], uses',
      settings: 'key',
      tombstones: '&uid, table, deletedAt',
      logs: '++id, at, level',
    });
  }
}

export const db = new YomanDb();

const log = logger('db');

/*
 * The database failing to open used to be completely silent.
 *
 * Every query simply rejected, the screens rendered empty, and the log — the
 * one thing that exists to explain a fault on site — said nothing at all. That
 * is not hypothetical: a second copy of the Mac app was left running for two
 * days holding this database open, and the log has no trace of it.
 *
 * Opening eagerly rather than waiting for the first query is the point: the
 * failure is recorded at startup, next to the `started` line, instead of
 * surfacing later as a screen that is merely empty.
 */
/**
 * Whether the diary's storage is actually usable, for the screens to read.
 *
 * `stuck` is the one that had to be added: a second copy of the app holding the
 * same profile makes `open()` hang *silently* — no error, no `blocked` event,
 * no event of any kind, ever. Every screen then renders its "loading" line
 * forever and the app looks broken with nothing to point at, which is precisely
 * the complaint this state exists to answer.
 */
export type DbHealth = 'opening' | 'open' | 'stuck' | 'failed';

let health: DbHealth = 'opening';
const healthWatchers = new Set<(state: DbHealth) => void>();

export const dbHealth = (): DbHealth => health;

/** Subscribes to storage health; returns the unsubscribe. */
export function onDbHealth(watcher: (state: DbHealth) => void): () => void {
  healthWatchers.add(watcher);
  watcher(health);
  return () => healthWatchers.delete(watcher);
}

function setHealth(next: DbHealth): void {
  if (health === next) return;
  health = next;
  for (const watcher of healthWatchers) {
    try {
      watcher(next);
    } catch {
      // A screen that throws while re-rendering must not take the others down.
    }
  }
}

/** Long enough that a slow phone opening a big diary is never called stuck. */
const OPEN_TIMEOUT_MS = 8000;

if (typeof indexedDB !== 'undefined') {
  const stuckTimer = setTimeout(() => {
    if (health === 'opening') {
      setHealth('stuck');
      log.error('database has not opened — another copy of the app is probably holding it');
    }
  }, OPEN_TIMEOUT_MS);

  void db
    .open()
    .then(() => {
      clearTimeout(stuckTimer);
      setHealth('open');
      log.info('database open', { version: db.verno });
    })
    .catch((error: unknown) => {
      clearTimeout(stuckTimer);
      setHealth('failed');
      log.error('database did not open', error);
    });

  // Another window or app instance holds an older version open, so the upgrade
  // cannot run. The diary is unreadable until that one is closed.
  db.on('blocked', () => {
    setHealth('stuck');
    log.error('database blocked by another window');
  });
}

/* ------------------------------------------------------------------ settings */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value, updatedAt: Date.now() });
}

export const ACTIVE_PROJECT_KEY = 'activeProjectId';

/* ------------------------------------------------------------------ projects */

export async function createProject(
  data: Omit<Project, 'id' | 'uid' | 'createdAt' | 'archived'>,
): Promise<number> {
  const id = await db.projects.add({
    ...data,
    uid: newUid(),
    archived: false,
    createdAt: Date.now(),
  } as Project);
  // First project becomes the active one, so the app is usable immediately.
  const active = await getSetting<number | null>(ACTIVE_PROJECT_KEY, null);
  if (active === null) await setSetting(ACTIVE_PROJECT_KEY, id);
  // Not the name: a project name is site data, and it is the same name the
  // export file names are built from, which `fileKind` already redacts.
  log.info('project created', { projects: await db.projects.count() });
  return id;
}

/** Deletes a project and every diary page under it. */
export async function deleteProject(id: number): Promise<void> {
  /*
   * A copy first, whenever there is something to lose.
   *
   * Deleting a project is the one action here that destroys diary pages
   * outright — they do not go to the trash, and the tombstones take the
   * deletion to the other device as well, so there is no second copy anywhere
   * to go back to. The screen says how many pages will go with it; this is what
   * makes the answer survivable if the wrong project was tapped.
   */
  if ((await db.entries.where('projectId').equals(id).count()) > 0) {
    try {
      const { backupNow } = await import('./lib/autoBackup');
      const where = await backupNow({ force: true });
      log.warn(where ? 'safety copy written before deleting a project' : 'no safety copy could be written');
    } catch (error) {
      log.warn('safety copy before deleting a project failed', error);
    }
  }

  let removed = 0;
  await db.transaction('rw', db.projects, db.entries, db.settings, db.tombstones, async () => {
    const project = await db.projects.get(id);
    const entries = await db.entries.where('projectId').equals(id).toArray();
    const now = Date.now();
    // Record the deletions before removing them, so the other device follows.
    await db.tombstones.bulkPut([
      ...(project ? [{ uid: project.uid, table: 'projects' as const, deletedAt: now }] : []),
      ...entries.map((entry) => ({ uid: entry.uid, table: 'entries' as const, deletedAt: now })),
    ]);
    await db.entries.where('projectId').equals(id).delete();
    await db.projects.delete(id);
    removed = entries.length;
    const active = await getSetting<number | null>(ACTIVE_PROJECT_KEY, null);
    if (active === id) {
      const next = await db.projects.filter((p) => !p.archived).first();
      await setSetting(ACTIVE_PROJECT_KEY, next?.id ?? null);
    }
  });
  // The single most destructive thing the app can do, and it left no trace.
  log.warn('project deleted', { pages: removed });
}

/* ------------------------------------------------------------------- entries */

export function blankEntry(
  projectId: number,
  date = isoDate(),
  projectUid = '',
): DiaryEntry {
  const now = Date.now();
  return {
    uid: newUid(),
    projectUid,
    projectId,
    date,
    weather: '',
    management: [],
    contractors: [],
    equipment: [],
    workDescription: '',
    casting: emptyCasting(),
    supervisorNotes: '',
    receivedToday: '',
    supervisorSignature: '',
    managerSignature: '',
    photos: [],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The page for a day, if there is one — ignoring the trash, so a date whose
 * page was thrown away is free to be written again.
 */
export async function findEntryByDate(
  projectId: number,
  date: string,
): Promise<DiaryEntry | undefined> {
  return db.entries
    .where({ projectId, date })
    .filter((e) => e.deletedAt === undefined)
    .first();
}

/**
 * The page before this date on the same site, if there is one.
 *
 * A site runs the same trades day after day, and the first thing anyone does on
 * a new page is write yesterday's crew into it again. This is what the "same as
 * the previous day" button reads — the *previous page*, not literally
 * yesterday, because a Friday page is followed by a Sunday one and a site that
 * stood idle for a week still ran the same way when it started again.
 */
export async function previousEntry(
  projectId: number,
  date: string,
): Promise<DiaryEntry | undefined> {
  const earlier = await db.entries
    .where('projectId')
    .equals(projectId)
    .filter((e) => e.deletedAt === undefined && e.date < date)
    .toArray();
  return earlier.sort((a, b) => b.date.localeCompare(a.date))[0];
}

/**
 * A page stops being a draft the moment the מנ"ע has signed it.
 *
 * That signature is what puts the day's diary in force on an Israeli site —
 * the מפקח's is not required for it, and waiting for one left pages sitting as
 * drafts long after they were finished. So the signature decides the status
 * rather than a button somebody has to remember to press.
 *
 * It only ever raises: with no signature the stored status is left alone, so
 * marking a page by hand still works for the days it was signed on paper.
 */
export function statusFor(entry: DiaryEntry): DiaryEntry['status'] {
  return entry.managerSignature?.trim() ? 'signed' : entry.status;
}

export async function saveEntry(entry: DiaryEntry): Promise<number> {
  const toSave: DiaryEntry = {
    ...entry,
    // Photographs are written as bytes, never as Blobs — a page saved on a
    // device that can still read its old Blobs migrates itself here. See
    // src/lib/photoData.ts for what that fixes.
    photos: await storablePhotos(entry.photos),
    status: statusFor(entry),
    updatedAt: Date.now(),
  };
  const id = await db.entries.put(toSave);
  await learnPresets(toSave);
  // The date, the counts and the status — never a word of what was written on
  // the page. This is the line that answers "I filled it in and it was gone
  // the next morning": either it is here, or the save never happened.
  log.info('page saved', {
    date: toSave.date,
    photos: toSave.photos.length,
    status: toSave.status,
    isNew: entry.id === undefined,
  });
  return id;
}

/**
 * Moves one diary page to the trash.
 *
 * A soft delete, and deliberately not a tombstone: the page is still a record,
 * still syncs, and still turns up on the other device — in *its* trash. Only
 * emptying the trash destroys it. A day's page is the account of what happened
 * on a site, and it should not be possible to lose one by a mis-tap and seven
 * seconds of not noticing.
 */
export async function deleteEntry(id: number): Promise<void> {
  const entry = await db.entries.get(id);
  if (!entry) return;
  const now = Date.now();
  await db.entries.update(id, { deletedAt: now, updatedAt: now });
  // Logged here rather than at the button, so a page trashed from the editor
  // leaves the same trace as one swiped away in the list. Deleting from the
  // editor used to leave none at all.
  log.info('page moved to trash', { date: entry.date, photos: entry.photos.length });
}

/**
 * Destroys a page for good, from the trash.
 *
 * This is where the tombstone is written — the record of a deletion that has to
 * travel, or the other device simply sends the page back on the next sync.
 */
export async function purgeEntry(id: number): Promise<void> {
  let gone: DiaryEntry | undefined;
  await db.transaction('rw', db.entries, db.tombstones, async () => {
    const entry = await db.entries.get(id);
    if (entry) {
      await db.tombstones.put({ uid: entry.uid, table: 'entries', deletedAt: Date.now() });
    }
    await db.entries.delete(id);
    gone = entry;
  });
  if (gone) {
    log.warn('page deleted for good', { date: gone.date, photos: gone.photos.length });
  }
}

/** Empties the trash. Returns how many pages were destroyed. */
export async function emptyTrash(projectId?: number): Promise<number> {
  const doomed = await trashedEntries(projectId);
  for (const entry of doomed) {
    if (entry.id !== undefined) await purgeEntry(entry.id);
  }
  log.warn('trash emptied', { pages: doomed.length });
  return doomed.length;
}

/** Pages in the trash, most recently deleted first. */
export async function trashedEntries(projectId?: number): Promise<DiaryEntry[]> {
  const rows = await db.entries.filter((e) => e.deletedAt !== undefined).toArray();
  return rows
    .filter((e) => projectId === undefined || e.projectId === projectId)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}

/**
 * Takes a page back out of the trash.
 *
 * The one-page-per-project-per-day rule still holds, and nothing stopped a new
 * page for that date being written while this one sat in the trash — so a
 * clash is refused rather than silently creating two pages for one day.
 */
export async function restoreFromTrash(id: number): Promise<void> {
  await db.transaction('rw', db.entries, async () => {
    const entry = await db.entries.get(id);
    if (!entry) return;
    const clash = await db.entries
      .where({ projectId: entry.projectId, date: entry.date })
      .filter((e) => e.uid !== entry.uid && e.deletedAt === undefined)
      .first();
    if (clash) throw new Error(`קיים כבר יומן לתאריך ${entry.date}`);
    // `deletedAt: undefined` would be dropped by IndexedDB's structured clone
    // rather than removed, so the field is deleted from a copy of the record.
    const { deletedAt: _gone, ...rest } = entry;
    await db.entries.put({ ...rest, updatedAt: Date.now() });
  });
  log.info('page restored from trash');
}

/**
 * Puts a deleted page back, for the undo offered right after a swipe.
 *
 * The tombstone has to go with it. Leaving it behind would let the *other*
 * device delete the page again the next time they sync — the deletion would
 * have outlived the undo, which is precisely the failure undo exists to
 * prevent. The record is stamped afresh so it also wins against any copy the
 * peer is still holding.
 */
export async function restoreEntry(entry: DiaryEntry): Promise<void> {
  await db.transaction('rw', db.entries, db.tombstones, async () => {
    // One page per project per day still holds. Nothing stops a new page for
    // that date being started inside the undo window, and putting the old one
    // back on top of it would break the invariant the whole editor relies on.
    const clash = await db.entries
      .where({ projectId: entry.projectId, date: entry.date })
      .first();
    if (clash && clash.uid !== entry.uid) {
      throw new Error(`קיים כבר יומן לתאריך ${entry.date}`);
    }
    await db.tombstones.delete(entry.uid);
    await db.entries.put({ ...entry, updatedAt: Date.now() });
  });
  log.info('page restored by undo', { date: entry.date });
}

/**
 * Pins or unpins a page.
 *
 * A targeted update rather than `saveEntry`: pinning is not an edit of the
 * form, so it should not re-learn the presets, and the photos have no business
 * being rewritten because a flag moved.
 */
export async function setEntryPinned(id: number, pinned: boolean): Promise<void> {
  await db.entries.update(id, { pinned, updatedAt: Date.now() });
}

export async function entriesInRange(
  projectId: number,
  from: string,
  to: string,
): Promise<DiaryEntry[]> {
  const rows = await db.entries
    .where('date')
    .between(from, to, true, true)
    // A page in the trash is not part of the record of the job, so it stays out
    // of every report and every total built from one.
    .filter((e) => e.projectId === projectId && e.deletedAt === undefined)
    .toArray();
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Copies yesterday's crew and equipment into a new page — on most sites the
 * same people show up two days running, and retyping the table is the single
 * most tedious part of keeping a diary.
 */
export async function duplicateForDate(
  source: DiaryEntry,
  date: string,
): Promise<DiaryEntry> {
  const existing = await findEntryByDate(source.projectId, date);
  if (existing) throw new Error(`קיים כבר יומן לתאריך ${date}`);
  const fresh = blankEntry(source.projectId, date, source.projectUid);
  return {
    ...fresh,
    management: source.management.map((r) => ({ ...r })),
    contractors: source.contractors.map((r) => ({ ...r })),
    equipment: source.equipment.map((r) => ({ ...r })),
    weather: source.weather,
  };
}

/* ------------------------------------------------------ ספקים וקבלנים */

export function blankContact(): Contact {
  const now = Date.now();
  return {
    uid: newUid(),
    name: '',
    trade: '',
    phone: '',
    projects: '',
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
}

/** True once a line holds anything at all; an untouched one is not worth keeping. */
export const contactIsBlank = (contact: Contact): boolean =>
  !`${contact.name}${contact.trade}${contact.phone}${contact.projects}${contact.notes}`.trim();

export async function saveContact(contact: Contact): Promise<number> {
  return db.contacts.put({ ...contact, updatedAt: Date.now() });
}

/** Deletes one line, recording it so the deletion syncs instead of coming back. */
export async function deleteContact(id: number): Promise<void> {
  await db.transaction('rw', db.contacts, db.tombstones, async () => {
    const contact = await db.contacts.get(id);
    if (contact) {
      await db.tombstones.put({ uid: contact.uid, table: 'contacts', deletedAt: Date.now() });
    }
    await db.contacts.delete(id);
  });
  // A count, never a name or a number: this list is somebody's contacts, and
  // the log file gets sent to other people.
  log.info('contact deleted', { contacts: await db.contacts.count() });
}

export interface ImportContactsResult {
  added: number;
  updated: number;
}

/**
 * Merges a list read from a file into the address book.
 *
 * Importing the same file twice must not double the list — which is exactly
 * what happens when the same supplier is added again under a new uid, and the
 * list a person actually has is the one they exported, edited a little, and
 * sent back. A line is therefore matched to an existing one by **name plus
 * phone**, or by name alone where one of the two has no number yet; anything
 * that matches is filled in rather than duplicated, and an existing value is
 * never overwritten with an empty one.
 */
export async function importContacts(rows: ContactDraft[]): Promise<ImportContactsResult> {
  const result: ImportContactsResult = { added: 0, updated: 0 };
  const digits = (phone: string) => phone.replace(/\D/g, '');
  const key = (name: string) => name.trim().toLowerCase();

  await db.transaction('rw', db.contacts, async () => {
    const existing = await db.contacts.toArray();

    for (const row of rows) {
      const name = (row.name ?? '').trim();
      const phone = (row.phone ?? '').trim();
      if (!name && !phone) continue;

      const match = existing.find((contact) => {
        if (key(contact.name) !== key(name)) return false;
        const a = digits(contact.phone);
        const b = digits(phone);
        // Same name and same number, or same name and one side has no number.
        return a === b || a === '' || b === '';
      });

      if (match?.id !== undefined) {
        const merged: Contact = {
          ...match,
          // `||` and not `??`: a blank cell in the file means "nothing to say
          // about this", not "erase what is here".
          name: name || match.name,
          trade: (row.trade ?? '').trim() || match.trade,
          phone: phone || match.phone,
          projects: (row.projects ?? '').trim() || match.projects,
          notes: (row.notes ?? '').trim() || match.notes,
          updatedAt: Date.now(),
        };
        await db.contacts.put(merged);
        Object.assign(match, merged);
        result.updated += 1;
      } else {
        const fresh: Contact = {
          ...blankContact(),
          name,
          trade: (row.trade ?? '').trim(),
          phone,
          projects: (row.projects ?? '').trim(),
          notes: (row.notes ?? '').trim(),
        };
        await db.contacts.add(fresh);
        // Kept in the same list, so two identical lines inside one file collapse
        // into one record instead of racing each other in.
        existing.push(fresh);
        result.added += 1;
      }
    }
  });

  // Counts only — an imported list is somebody's contacts.
  log.info('contacts imported', { ...result, rows: rows.length });
  return result;
}

/** Puts a deleted line back, for the undo offered instead of a confirmation. */
export async function restoreContact(contact: Contact): Promise<void> {
  await db.transaction('rw', db.contacts, db.tombstones, async () => {
    // The tombstone goes with it, exactly as in `restoreEntry`: left behind, it
    // would let the other device delete the line again on the next sync, having
    // outlived the undo.
    await db.tombstones.delete(contact.uid);
    await db.contacts.put({ ...contact, updatedAt: Date.now() });
  });
}

/* ------------------------------------------------------------------- presets */

async function bumpPreset(kind: PresetKind, raw: string): Promise<void> {
  const value = raw.trim();
  if (!value) return;
  const existing = await db.presets.where({ kind, value }).first();
  if (existing?.id !== undefined) {
    await db.presets.update(existing.id, {
      uses: existing.uses + 1,
      updatedAt: Date.now(),
    });
  } else {
    await db.presets.add({ kind, value, uses: 1, updatedAt: Date.now() });
  }
}

/** Harvests every typed value from a saved page into the dropdown lists. */
async function learnPresets(entry: DiaryEntry): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const row of entry.management) {
    jobs.push(bumpPreset('staff', row.name), bumpPreset('role', row.role));
  }
  for (const row of entry.contractors) jobs.push(bumpPreset('trade', row.trade));
  for (const row of entry.equipment) jobs.push(bumpPreset('equipment', row.kind));
  jobs.push(bumpPreset('weather', entry.weather));
  jobs.push(bumpPreset('concreteType', entry.casting.concreteType));
  await Promise.all(jobs);
}

/** Most-used values first — the list the comboboxes offer. */
export async function presetValues(kind: PresetKind): Promise<string[]> {
  const rows = await db.presets.where('kind').equals(kind).toArray();
  return rows
    .sort((a, b) => b.uses - a.uses || a.value.localeCompare(b.value, 'he'))
    .map((r) => r.value);
}

export async function addPreset(kind: PresetKind, value: string): Promise<void> {
  await bumpPreset(kind, value);
}

export async function deletePreset(id: number): Promise<void> {
  await db.presets.delete(id);
}

/* -------------------------------------------------------- backup and restore */

const BACKUP_FORMAT = 'yoman-avoda-backup';
const BACKUP_VERSION = 1;

interface BackupFile {
  format: string;
  version: number;
  exportedAt: string;
  projects: Project[];
  presets: Preset[];
  /**
   * Optional, and `BACKUP_VERSION` deliberately does not move for it.
   *
   * Bumping the version would make every older build *refuse* the file — the
   * check above throws on a backup newer than itself — which is the opposite of
   * what a backup is for. An added array that old builds simply ignore keeps
   * the file readable both ways, the same bargain `receivedToday` and `pinned`
   * struck on the wire.
   */
  contacts?: Contact[];
  /** Photos travel as data URLs, since JSON cannot hold a Blob. */
  entries: (Omit<DiaryEntry, 'photos'> & {
    photos: (Omit<import('./types').Photo, 'blob'> & { dataUrl: string })[];
  })[];
}

export async function backupToJson(): Promise<string> {
  const [projects, entries, presets, contacts] = await Promise.all([
    db.projects.toArray(),
    db.entries.toArray(),
    db.presets.toArray(),
    db.contacts.toArray(),
  ]);

  const serialisedEntries = await Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      photos: await Promise.all(
        entry.photos.map(async (photo) => {
          const { blob, bytes, ...rest } = photo;
          void blob;
          void bytes;
          const data = await photoBytes(photo);
          // A photo whose bytes cannot be read still goes into the backup, as
          // an empty one: the caption and the date are what is left of it, and
          // dropping the record would lose those too.
          return { ...rest, dataUrl: data ? bytesToDataUrl(data) : '' };
        }),
      ),
    })),
  );

  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    projects,
    presets,
    contacts,
    entries: serialisedEntries,
  };
  const json = JSON.stringify(file);
  log.info('backup written', {
    projects: projects.length,
    entries: entries.length,
    contacts: contacts.length,
    photos: serialisedEntries.reduce((n, e) => n + e.photos.length, 0),
    bytes: json.length,
  });
  return json;
}

export interface RestoreResult {
  projects: number;
  entries: number;
}

/** What a backup file holds, and what it would be replacing. */
export interface BackupSummary {
  projects: number;
  entries: number;
  contacts: number;
  photos: number;
  /** Earliest and latest diary date in the file, or '' when it holds none. */
  from: string;
  to: string;
}

/**
 * Reads a backup file without touching anything.
 *
 * A restore replaces the whole diary, and the only thing standing between a
 * month of work and an empty screen was a warning that said the same words
 * whatever the file held. One of the automatic backups in this user's own
 * folder is 137 bytes — a copy taken while the diary was empty — and restoring
 * it would have been indistinguishable, right up to the moment it finished.
 * The screen asks with these numbers in the question now.
 *
 * Throws exactly what `restoreFromJson` throws for a file it will not take, so
 * a bad file is refused before anything is cleared rather than after.
 */
export function inspectBackup(json: string): BackupSummary {
  const parsed = JSON.parse(json) as BackupFile;
  if (parsed.format !== BACKUP_FORMAT) {
    throw new Error('הקובץ אינו קובץ גיבוי של יומן עבודה');
  }
  if (parsed.version > BACKUP_VERSION) {
    throw new Error('הגיבוי נוצר בגרסה חדשה יותר של האפליקציה');
  }
  const entries = parsed.entries ?? [];
  const dates = entries.map((entry) => entry.date).filter(Boolean).sort();
  return {
    projects: (parsed.projects ?? []).length,
    entries: entries.length,
    contacts: (parsed.contacts ?? []).length,
    photos: entries.reduce((sum, entry) => sum + (entry.photos?.length ?? 0), 0),
    from: dates[0] ?? '',
    to: dates[dates.length - 1] ?? '',
  };
}

/** What is on this device now, for the same question. */
export async function diaryCounts(): Promise<{ projects: number; entries: number }> {
  const [projects, entries] = await Promise.all([db.projects.count(), db.entries.count()]);
  return { projects, entries };
}

/** Replaces all local data with the contents of a backup file. */
export async function restoreFromJson(json: string): Promise<RestoreResult> {
  // Recorded before anything is touched, because the next line may throw and
  // this is the operation that replaces the entire diary: whether a restore was
  // even attempted is the first thing to know afterwards.
  log.warn('restoring a backup', {
    bytes: json.length,
    replacing: { projects: await db.projects.count(), entries: await db.entries.count() },
  });

  const parsed = JSON.parse(json) as BackupFile;
  if (parsed.format !== BACKUP_FORMAT) {
    log.error('restore refused: not a diary backup');
    throw new Error('הקובץ אינו קובץ גיבוי של יומן עבודה');
  }
  if (parsed.version > BACKUP_VERSION) {
    log.error('restore refused: backup is newer than this build', {
      backup: parsed.version,
      supported: BACKUP_VERSION,
    });
    throw new Error('הגיבוי נוצר בגרסה חדשה יותר של האפליקציה');
  }

  /*
   * A copy of what is about to be replaced, written to disk first.
   *
   * This is the one operation in the app that destroys data outright, and it is
   * driven by picking a file out of a list of similarly named ones. The copy
   * costs a second and turns "I restored the wrong backup" from the end of the
   * diary into a second restore. It never blocks the restore the user asked
   * for: a device with nowhere to write one — a plain browser — says so in the
   * log and carries on.
   */
  try {
    const { backupNow } = await import('./lib/autoBackup');
    const where = await backupNow({ force: true });
    log.warn(where ? 'safety copy written before restoring' : 'no safety copy could be written');
  } catch (error) {
    log.warn('safety copy before restoring failed', error);
  }

  const entries: DiaryEntry[] = await Promise.all(
    parsed.entries.map(async (entry) => ({
      ...entry,
      photos: entry.photos.map(({ dataUrl, ...rest }) => ({
        ...rest,
        bytes: dataUrlToBytes(dataUrl),
      })),
    })),
  );

  // The array form, not the variadic one: Dexie only types the latter up to
  // five tables, and the restore now touches six.
  await db.transaction(
    'rw',
    [db.projects, db.entries, db.contacts, db.presets, db.settings, db.tombstones],
    async () => {
      await Promise.all([
        db.projects.clear(),
        db.entries.clear(),
        db.contacts.clear(),
        db.presets.clear(),
        /*
         * The tombstones go too, and leaving them behind was silent data loss.
         *
         * A tombstone is stamped with the moment of the deletion, and a page
         * coming out of a backup carries whatever `updatedAt` it had when the
         * backup was written — necessarily *earlier*, since the deletion came
         * after. `applyPayload` resolves that pair by the stamps, so the next
         * sync would look at a page the user had just deliberately restored,
         * find a newer tombstone for it, and delete it again. The user would
         * see the page come back and then vanish, with nothing to point at.
         *
         * A restore means "this file is now the diary", so a deletion that is
         * not in the file is no longer part of it either.
         */
        db.tombstones.clear(),
      ]);
      // Backups written before sync existed have no uids; mint them on the way
      // in so a restored diary can still take part in syncing.
      const uidByProjectId = new Map<number | undefined, string>();
      const projects = parsed.projects.map((project) => {
        const uid = project.uid ?? newUid();
        uidByProjectId.set(project.id, uid);
        return { ...project, uid };
      });
      await db.projects.bulkAdd(projects);
      /*
       * Restored pages are stamped afresh, the same rule `restoreEntry` applies
       * after a swipe-undo and for the same reason.
       *
       * Clearing our own tombstones is only half of it: the *other* device still
       * holds its copy, keeps it for ninety days, and sends it on the next sync.
       * A page carrying its original — necessarily older — `updatedAt` loses to
       * that tombstone and is deleted all over again. Stamping is what makes the
       * restore the last write, which is what the user just asked it to be.
       */
      const restoredAt = Date.now();
      await db.entries.bulkAdd(
        entries.map((entry) => ({
          ...entry,
          uid: entry.uid ?? newUid(),
          projectUid: entry.projectUid || uidByProjectId.get(entry.projectId) || '',
          updatedAt: restoredAt,
        })),
      );
      await db.presets.bulkAdd(parsed.presets);
      // Stamped afresh like the pages, and for the same reason: the peer still
      // holds tombstones for lines deleted since the backup was written, and a
      // restore has to be the last write or the merge undoes it.
      await db.contacts.bulkAdd(
        (parsed.contacts ?? []).map((contact) => ({
          ...contact,
          uid: contact.uid ?? newUid(),
          updatedAt: restoredAt,
        })),
      );
      const first = parsed.projects.find((p) => !p.archived) ?? parsed.projects[0];
      await setSetting(ACTIVE_PROJECT_KEY, first?.id ?? null);
    },
  );

  log.info('backup restored', {
    projects: parsed.projects.length,
    entries: entries.length,
    contacts: parsed.contacts?.length ?? 0,
    presets: parsed.presets.length,
  });
  return { projects: parsed.projects.length, entries: entries.length };
}

/** Rough on-device footprint, shown in Settings. */
export async function estimateUsage(): Promise<{ used: number; quota: number }> {
  if (!navigator.storage?.estimate) return { used: 0, quota: 0 };
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { used: usage, quota };
}
