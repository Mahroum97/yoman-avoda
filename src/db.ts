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
import { SYNCED_SETTINGS } from './sync/protocol';
import { preserveReportFields } from './lib/reportFields';
import { flushPendingWrites } from './lib/pendingWrites';
import {
  advanceEntryRevision,
  compareEntryRevisions,
  entryRevisionContent,
  legacyEntryRevision,
  mergeEquivalentEntryRevisions,
  revisionWinner,
  stableConflictBranchUid,
  validatedEntryRevision,
} from './sync/revision';

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

    // v7 gives projects a real modification stamp. Using `createdAt` for the
    // sync manifest made every later name/address/company edit invisible, and
    // also made a restored project lose to a deletion made after its creation.
    this.version(7)
      .stores({
        projects: '++id, &uid, name, archived, createdAt, updatedAt, [uid+updatedAt]',
        entries:
          '++id, &uid, projectUid, projectId, date, [projectId+date], status, updatedAt, [uid+updatedAt]',
        contacts: '++id, &uid, name, trade, updatedAt, [uid+updatedAt]',
        presets: '++id, kind, [kind+value], uses',
        settings: 'key',
        tombstones: '&uid, table, deletedAt',
        logs: '++id, at, level',
      })
      .upgrade((tx) =>
        tx
          .table('projects')
          .toCollection()
          .modify((project: Project) => {
            project.updatedAt ??= project.createdAt;
          }),
      );

    // v8 gives each entry a causal revision. The compound index keeps sync's
    // manifest on index keys: even after adding vector metadata, inventorying
    // the diary must never deserialize the photographs in each record.
    this.version(8)
      .stores({
        projects: '++id, &uid, name, archived, createdAt, updatedAt, [uid+updatedAt]',
        entries:
          '++id, &uid, projectUid, projectId, date, [projectId+date], status, updatedAt, [uid+updatedAt], [uid+updatedAt+syncRevision]',
        contacts: '++id, &uid, name, trade, updatedAt, [uid+updatedAt]',
        presets: '++id, kind, [kind+value], uses',
        settings: 'key',
        tombstones: '&uid, table, deletedAt',
        logs: '++id, at, level',
      })
      .upgrade((tx) =>
        tx
          .table('entries')
          .toCollection()
          .modify((entry: DiaryEntry) => {
            entry.syncRevision ??= legacyEntryRevision(entry);
          }),
      );
  }
}

export const db = new YomanDb();

const log = logger('db');

/**
 * A local write must advance from the record it replaces, even when the clock
 * moved backwards or restore deliberately stamped data past a known future
 * tombstone. Raw `Date.now()` would make the first edit after that look older.
 */
const nextUpdatedAt = (...known: (number | undefined)[]): number =>
  Math.max(Date.now(), ...known.filter((value): value is number => Number.isFinite(value))) + 1;

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
  await db.transaction('rw', db.settings, async () => {
    const current = await db.settings.get(key);
    await db.settings.put({ key, value, updatedAt: nextUpdatedAt(current?.updatedAt) });
  });
}

export const ACTIVE_PROJECT_KEY = 'activeProjectId';

/* ------------------------------------------------------------------ projects */

export async function createProject(
  data: Omit<Project, 'id' | 'uid' | 'createdAt' | 'updatedAt' | 'archived'>,
): Promise<number> {
  const now = Date.now();
  let id = 0;
  await db.transaction('rw', db.projects, db.settings, async () => {
    id = await db.projects.add({
      ...data,
      uid: newUid(),
      archived: false,
      createdAt: now,
      updatedAt: now,
    } as Project);
    // First project becomes active in the same commit. If settings storage
    // fails, the project add rolls back and retry cannot create a duplicate.
    const active = await db.settings.get(ACTIVE_PROJECT_KEY);
    if (!active || active.value === null) {
      await db.settings.put({
        key: ACTIVE_PROJECT_KEY,
        value: id,
        updatedAt: nextUpdatedAt(active?.updatedAt),
      });
    }
  });
  // Not the name: a project name is site data, and it is the same name the
  // export file names are built from, which `fileKind` already redacts.
  log.info('project created', { projects: await db.projects.count() });
  return id;
}

/** Updates project details with a stamp that remains monotonic after restore. */
export async function updateProject(
  id: number,
  changes: Pick<Project, 'name' | 'address' | 'company'>,
): Promise<void> {
  await db.transaction('rw', db.projects, async () => {
    const current = await db.projects.get(id);
    if (!current) return;
    await db.projects.update(id, {
      ...changes,
      updatedAt: nextUpdatedAt(current.updatedAt, current.createdAt),
    });
  });
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
    const now = nextUpdatedAt(
      project?.updatedAt,
      project?.createdAt,
      ...entries.map((entry) => entry.updatedAt),
    );
    // Record the deletions before removing them, so the other device follows.
    await db.tombstones.bulkPut([
      ...(project ? [{ uid: project.uid, table: 'projects' as const, deletedAt: now }] : []),
      ...entries.map((entry) => {
        const deleted = { ...entry, deletedAt: now, updatedAt: now };
        return {
          uid: entry.uid,
          table: 'entries' as const,
          deletedAt: now,
          entryRevision: advanceEntryRevision(
            deleted,
            validatedEntryRevision(entry),
          ),
        };
      }),
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

/** A save would create two live pages for one project and date. */
export class EntryDateConflictError extends Error {
  readonly date: string;

  constructor(date: string) {
    super(`קיים כבר יומן לתאריך ${date}`);
    this.name = 'EntryDateConflictError';
    this.date = date;
  }
}

/** A stale editor tried to write a page that has since been deleted for good. */
export class EntryUnavailableError extends Error {
  constructor() {
    super('היומן אינו זמין עוד');
    this.name = 'EntryUnavailableError';
  }
}

export interface SavedEntryResult {
  id: number;
  uid: string;
  updatedAt: number;
  syncRevision: string;
  syncConflict: boolean;
  syncConflictKind?: 'revision' | 'deletion';
  syncConflictGroup?: string;
  syncConflictRoot?: string;
  /** A changed stored revision was retained as a second marked page. */
  conflictPreserved: boolean;
}

interface RevisionExpectation {
  /** `null` means this editor expects that its new UID does not exist yet. */
  updatedAt: number | null;
  /** Causal head loaded/adopted by the editor; null means a new legacy-free row. */
  syncRevision?: string | null;
}

async function putStableConflictBranch(
  branch: DiaryEntry,
  rootUid: string,
  group: string,
): Promise<DiaryEntry> {
  const syncRevision = validatedEntryRevision(branch);
  const uid = stableConflictBranchUid(rootUid, syncRevision);
  const held = await db.entries.where('uid').equals(uid).first();
  if (held && validatedEntryRevision(held) !== syncRevision) {
    throw new Error('CONFLICT_UID_COLLISION');
  }
  const record: DiaryEntry = {
    ...branch,
    id: held?.id,
    uid,
    syncRevision,
    syncConflict: true,
    syncConflictKind: 'revision',
    syncConflictGroup: group,
    syncConflictRoot: rootUid,
  };
  record.id = await db.entries.put(record);
  return record;
}

async function persistEntry(
  entry: DiaryEntry,
  expectation: RevisionExpectation | null,
): Promise<SavedEntryResult> {
  const toSave: DiaryEntry = {
    ...entry,
    // Photographs are written as bytes, never as Blobs — a page saved on a
    // device that can still read its old Blobs migrates itself here. See
    // src/lib/photoData.ts for what that fixes.
    photos: await storablePhotos(entry.photos),
    status: statusFor(entry),
    updatedAt: Date.now(),
  };
  let id = 0;
  let saved = toSave;
  let conflictPreserved = false;
  let resolvedDeletionRevision: string | undefined;
  await db.transaction('rw', db.projects, db.entries, db.tombstones, async () => {
    /*
     * A page may already have been saved while this caller was waiting behind
     * an earlier autosave. Match its stable uid before deciding that an absent
     * numeric id means "new"; otherwise two first saves either collide on the
     * uid index or create a second live page for the date.
     */
    const [project, byUid, byId, tombstone] = await Promise.all([
      db.projects.get(toSave.projectId),
      db.entries.where('uid').equals(toSave.uid).first(),
      toSave.id === undefined ? undefined : db.entries.get(toSave.id),
      db.tombstones.get(toSave.uid),
    ]);

    if (!project || (toSave.projectUid && project.uid !== toSave.projectUid)) {
      throw new EntryUnavailableError();
    }
    if (byId && byId.uid !== toSave.uid) throw new EntryUnavailableError();
    const current = byUid ?? byId;

    if (tombstone?.table === 'entries') {
      if (!current) throw new EntryUnavailableError();
      const currentRevision = validatedEntryRevision(current);
      if (tombstone.entryRevision) {
        const deletionOrder = compareEntryRevisions(
          currentRevision,
          tombstone.entryRevision,
        );
        if (deletionOrder === 'remote-ahead' || deletionOrder === 'same') {
          throw new EntryUnavailableError();
        }
        // Saving a branch concurrent with a permanent deletion is the user's
        // explicit choice to keep it. Join the deletion clock into the new head
        // and remove the obsolete tombstone so it cannot suppress that choice.
        resolvedDeletionRevision = tombstone.entryRevision;
        await db.tombstones.delete(toSave.uid);
      } else if (current.updatedAt <= tombstone.deletedAt) {
        throw new EntryUnavailableError();
      } else {
        await db.tombstones.delete(toSave.uid);
      }
    }

    if (expectation) {
      if (!current && expectation.updatedAt !== null) {
        throw new EntryUnavailableError();
      }
      if (current?.deletedAt !== undefined && toSave.deletedAt === undefined) {
        throw new EntryUnavailableError();
      }
    }

    /*
     * The lookup and put share one read-write transaction. Two windows can both
     * pass the editor's friendly pre-check; IndexedDB serialises these store
     * transactions, so the second one sees what the first committed and stops.
     * Trashed pages are excluded deliberately: writing that date again while
     * the old page remains recoverable is supported.
     */
    const clash = await db.entries
      .where({ projectId: toSave.projectId, date: toSave.date })
      .filter((other) => other.uid !== toSave.uid && other.deletedAt === undefined)
      .first();
    // Sync keeps two independently-created pages instead of deleting either.
    // Those marked copies remain editable until one is moved to the trash;
    // an ordinary attempt to create a duplicate date is still refused.
    if (
      clash &&
      !(current?.syncConflict && clash.syncConflict)
    ) {
      throw new EntryDateConflictError(toSave.date);
    }

    saved = preserveReportFields(current?.id === undefined ? toSave : { ...toSave, id: current.id }, current);
    saved = {
      ...saved,
      // A stale snapshot and undo must not lower a status already committed.
      status: current?.status === 'signed' ? 'signed' : saved.status,
      // These are merge metadata, not editable form fields. A queued UI
      // snapshot must not resurrect a marker that another operation resolved.
      syncConflict: current ? current.syncConflict : saved.syncConflict,
      syncConflictKind: current ? current.syncConflictKind : saved.syncConflictKind,
      syncConflictGroup: current ? current.syncConflictGroup : saved.syncConflictGroup,
      syncConflictRoot: current ? current.syncConflictRoot : saved.syncConflictRoot,
      updatedAt: nextUpdatedAt(current?.updatedAt, saved.updatedAt),
    };
    // A stale editor must not bring a page back out of the trash. Restoration
    // has its own checked path (`restoreFromTrash`) that removes this marker.
    if (current?.deletedAt !== undefined && saved.deletedAt === undefined) {
      saved = { ...saved, deletedAt: current.deletedAt };
    }
    if (resolvedDeletionRevision && saved.syncConflictGroup === `deletion:${toSave.uid}`) {
      saved = {
        ...saved,
        syncConflict: false,
        syncConflictKind: undefined,
        syncConflictGroup: undefined,
        syncConflictRoot: undefined,
      };
    }

    const currentRevision = current ? validatedEntryRevision(current) : undefined;
    const changedBehindEditor =
      !!expectation &&
      current !== undefined &&
      (expectation.updatedAt === null ||
        current.updatedAt !== expectation.updatedAt ||
        (expectation.syncRevision !== undefined &&
          (expectation.syncRevision === null ||
            compareEntryRevisions(expectation.syncRevision, currentRevision) !== 'same')));
    const revisionBase = changedBehindEditor
      ? expectation?.syncRevision ?? toSave.syncRevision
      : currentRevision ?? toSave.syncRevision;
    saved.syncRevision = advanceEntryRevision(
      saved,
      revisionBase,
      undefined,
      [resolvedDeletionRevision],
    );

    if (changedBehindEditor && current && currentRevision) {
      const relation = compareEntryRevisions(currentRevision, saved.syncRevision);
      const sameContent =
        entryRevisionContent(currentRevision) === entryRevisionContent(saved.syncRevision);
      const merged = sameContent
        ? mergeEquivalentEntryRevisions(currentRevision, saved.syncRevision)
        : null;
      if (relation === 'remote-ahead') {
        // The candidate causally descends from the stored head; only its wall
        // clock stamp changed behind the editor, so this is an ordinary save.
      } else if (merged) {
        saved = {
          ...saved,
          id: current.id,
          uid: current.uid,
          syncRevision: merged,
          syncConflict: current.syncConflict || saved.syncConflict,
          syncConflictKind:
            current.syncConflictKind ?? saved.syncConflictKind,
          syncConflictGroup: current.syncConflictGroup ?? saved.syncConflictGroup,
          syncConflictRoot: current.syncConflictRoot ?? saved.syncConflictRoot,
        };
      } else {
        const rootUid = current.syncConflictRoot ?? current.uid;
        const group = current.syncConflictGroup ?? `revision:${rootUid}`;
        const winner = revisionWinner(currentRevision, saved.syncRevision);
        if (winner === 'local') {
          const main: DiaryEntry = {
            ...current,
            syncRevision: currentRevision,
            syncConflict: true,
            syncConflictKind: 'revision',
            syncConflictGroup: group,
            syncConflictRoot: rootUid,
            updatedAt: nextUpdatedAt(current.updatedAt, saved.updatedAt),
          };
          await db.entries.put(main);
          saved = await putStableConflictBranch(saved, rootUid, group);
        } else {
          await putStableConflictBranch(current, rootUid, group);
          saved = {
            ...saved,
            id: current.id,
            uid: current.uid,
            syncConflict: true,
            syncConflictKind: 'revision',
            syncConflictGroup: group,
            syncConflictRoot: rootUid,
          };
        }
        conflictPreserved = true;
      }
    }
    id = await db.entries.put(saved);
  });
  await learnPresets(saved);
  // The date, the counts and the status — never a word of what was written on
  // the page. This is the line that answers "I filled it in and it was gone
  // the next morning": either it is here, or the save never happened.
  log.info('page saved', {
    date: saved.date,
    photos: saved.photos.length,
    status: saved.status,
    isNew: entry.id === undefined,
    conflictPreserved,
  });
  if (conflictPreserved) {
    log.warn('saved both revisions after the page changed behind an editor');
  }
  return {
    id,
    uid: saved.uid,
    updatedAt: saved.updatedAt,
    syncRevision: saved.syncRevision!,
    syncConflict: !!saved.syncConflict,
    syncConflictKind: saved.syncConflictKind,
    syncConflictGroup: saved.syncConflictGroup,
    syncConflictRoot: saved.syncConflictRoot,
    conflictPreserved,
  };
}

/** Ordinary internal save used when the caller does not own a loaded revision. */
export async function saveEntry(entry: DiaryEntry): Promise<number> {
  return (await persistEntry(entry, null)).id;
}

/**
 * Saves an editor draft with optimistic revision checking.
 *
 * On a mismatch the stored revision is first preserved as a marked conflict
 * page, then the visible draft is committed and this result reports it. The
 * caller updates its expected stamp only after this promise succeeds.
 */
export async function saveEntryChecked(
  entry: DiaryEntry,
  expectedUpdatedAt: number | null,
  expectedSyncRevision?: string | null,
): Promise<SavedEntryResult> {
  return persistEntry(entry, {
    updatedAt: expectedUpdatedAt,
    syncRevision: expectedSyncRevision,
  });
}

/** Clears the warning once only one live version of a project/date remains. */
async function clearResolvedEntryConflict(
  entry: Pick<DiaryEntry, 'projectId' | 'date' | 'syncConflictGroup'>,
  after?: number,
): Promise<void> {
  const live = entry.syncConflictGroup
    ? await db.entries
        .where('projectId')
        .equals(entry.projectId)
        .filter(
          (candidate) =>
            candidate.deletedAt === undefined &&
            candidate.syncConflictGroup === entry.syncConflictGroup,
        )
        .toArray()
    : await db.entries
        .where({ projectId: entry.projectId, date: entry.date })
        .filter((candidate) => candidate.deletedAt === undefined)
        .toArray();
  if (
    live.length !== 1 ||
    !live[0].syncConflict ||
    live[0].syncConflictKind === 'deletion' ||
    live[0].id === undefined
  ) {
    return;
  }
  await db.entries.update(live[0].id, {
    syncConflict: false,
    syncConflictKind: undefined,
    updatedAt: nextUpdatedAt(live[0].updatedAt, after),
  });
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
  let entry: DiaryEntry | undefined;
  await db.transaction('rw', db.entries, async () => {
    entry = await db.entries.get(id);
    if (!entry) return;
    const now = nextUpdatedAt(entry.updatedAt, entry.deletedAt);
    const deleted: DiaryEntry = { ...entry, deletedAt: now, updatedAt: now };
    deleted.syncRevision = advanceEntryRevision(
      deleted,
      validatedEntryRevision(entry),
    );
    await db.entries.put(deleted);
    await clearResolvedEntryConflict(entry, now);
  });
  if (!entry) return;
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
      const existingStone = await db.tombstones.get(entry.uid);
      const deletedAt = nextUpdatedAt(entry.updatedAt, entry.deletedAt, existingStone?.deletedAt);
      const deleted = { ...entry, deletedAt, updatedAt: deletedAt };
      await db.tombstones.put({
        uid: entry.uid,
        table: 'entries',
        deletedAt,
        entryRevision: advanceEntryRevision(
          deleted,
          validatedEntryRevision(entry),
          undefined,
          [existingStone?.entryRevision],
        ),
      });
    }
    await db.entries.delete(id);
    if (entry) {
      await clearResolvedEntryConflict(entry, entry.updatedAt);
    }
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

async function liveConflictPeers(entry: DiaryEntry): Promise<DiaryEntry[]> {
  if (!entry.syncConflictGroup) return [];
  return db.entries
    .where('projectId')
    .equals(entry.projectId)
    .filter(
      (candidate) =>
        candidate.uid !== entry.uid &&
        candidate.deletedAt === undefined &&
        candidate.syncConflictGroup === entry.syncConflictGroup,
    )
    .toArray();
}

const conflictGroupFor = (...uids: string[]): string =>
  `conflict:${[...uids].sort().join(':')}`;

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
    const related = await liveConflictPeers(entry);
    if (clash || related.length > 0) throw new EntryDateConflictError(entry.date);
    // `deletedAt: undefined` would be dropped by IndexedDB's structured clone
    // rather than removed, so the field is deleted from a copy of the record.
    const { deletedAt: _gone, ...rest } = entry;
    const restored: DiaryEntry = {
      ...rest,
      syncConflict: false,
      syncConflictKind: undefined,
      syncConflictGroup: undefined,
      syncConflictRoot: undefined,
      updatedAt: nextUpdatedAt(entry.updatedAt),
    };
    restored.syncRevision = advanceEntryRevision(
      restored,
      validatedEntryRevision(entry),
    );
    await db.entries.put(restored);
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
      .filter((other) => other.uid !== entry.uid && other.deletedAt === undefined)
      .first();
    const related = await liveConflictPeers(entry);
    const clashIsRelated = !!clash && related.some((peer) => peer.uid === clash.uid);
    if (
      (!entry.syncConflict && (clash || related.length > 0)) ||
      (clash && entry.syncConflictGroup && !clashIsRelated)
    ) {
      throw new EntryDateConflictError(entry.date);
    }
    const peers = [...related];
    if (clash && !peers.some((peer) => peer.uid === clash.uid)) peers.push(clash);
    const conflictGroup =
      peers.length > 0
        ? entry.syncConflictGroup ??
          peers.find((peer) => peer.syncConflictGroup)?.syncConflictGroup ??
          conflictGroupFor(entry.uid, ...peers.map((peer) => peer.uid))
        : undefined;
    for (const peer of peers) {
      if (peer.id === undefined) continue;
      await db.entries.update(peer.id, {
        syncConflict: true,
        syncConflictKind: 'revision',
        syncConflictGroup: conflictGroup,
        updatedAt: nextUpdatedAt(peer.updatedAt, entry.updatedAt),
      });
    }
    const tombstone = await db.tombstones.get(entry.uid);
    await db.tombstones.delete(entry.uid);
    const restored: DiaryEntry = {
      ...entry,
      syncConflict: peers.length > 0,
      syncConflictKind: peers.length > 0 ? 'revision' : undefined,
      syncConflictGroup: conflictGroup,
      updatedAt: nextUpdatedAt(
        entry.updatedAt,
        ...peers.map((peer) => peer.updatedAt),
        tombstone?.deletedAt,
      ),
    };
    restored.syncRevision = advanceEntryRevision(
      restored,
      validatedEntryRevision(entry),
      undefined,
      [tombstone?.entryRevision],
    );
    await db.entries.put(restored);
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
  await db.transaction('rw', db.entries, async () => {
    const entry = await db.entries.get(id);
    if (!entry) return;
    const updated: DiaryEntry = {
      ...entry,
      pinned,
      updatedAt: nextUpdatedAt(entry.updatedAt),
    };
    updated.syncRevision = advanceEntryRevision(
      updated,
      validatedEntryRevision(entry),
    );
    await db.entries.put(updated);
  });
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
  let id = 0;
  await db.transaction('rw', db.contacts, db.tombstones, async () => {
    const [byUid, byId, tombstone] = await Promise.all([
      db.contacts.where('uid').equals(contact.uid).first(),
      contact.id === undefined ? undefined : db.contacts.get(contact.id),
      db.tombstones.get(contact.uid),
    ]);
    if (tombstone?.table === 'contacts') throw new EntryUnavailableError();
    if (byId && byId.uid !== contact.uid) throw new EntryUnavailableError();
    const current = byUid ?? byId;
    id = await db.contacts.put({
      ...contact,
      ...(current?.id === undefined ? {} : { id: current.id }),
      updatedAt: nextUpdatedAt(current?.updatedAt, contact.updatedAt),
    });
  });
  return id;
}

/** Deletes one line, recording it so the deletion syncs instead of coming back. */
export async function deleteContact(id: number): Promise<void> {
  await db.transaction('rw', db.contacts, db.tombstones, async () => {
    const contact = await db.contacts.get(id);
    if (contact) {
      await db.tombstones.put({
        uid: contact.uid,
        table: 'contacts',
        deletedAt: nextUpdatedAt(contact.updatedAt),
      });
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
          updatedAt: nextUpdatedAt(match.updatedAt),
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
    const [current, tombstone] = await Promise.all([
      db.contacts.where('uid').equals(contact.uid).first(),
      db.tombstones.get(contact.uid),
    ]);
    await db.tombstones.delete(contact.uid);
    await db.contacts.put({
      ...contact,
      ...(current?.id === undefined ? {} : { id: current.id }),
      updatedAt: nextUpdatedAt(contact.updatedAt, current?.updatedAt, tombstone?.deletedAt),
    });
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
   * Diary-owned settings (logo, document look and saved signatures).
   * Optional so backups from before settings were included still restore.
   */
  settings?: Setting[];
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

interface BackupStateRows {
  projects: Project[];
  entries: DiaryEntry[];
  presets: Preset[];
  contacts: Contact[];
  settings: Setting[];
  tombstones: Tombstone[];
}

interface BackupState {
  projects: [string, number][];
  entries: [string, number, string][];
  contacts: [string, number][];
  presets: [number, number, number][];
  settings: [string, number][];
  tombstones: [string, number, string][];
}

/**
 * Compact identity-and-revision fingerprint for the exact state a backup saw.
 *
 * Values and photo bytes stay out of this string. Every production mutation
 * advances its record stamp, while identities and counts make deletion visible.
 * Preset ids are local but stable between backups on this device, which is all
 * this comparison needs. Keeping the canonical rows rather than a lossy maximum
 * also detects changes to an older record when another record has a future stamp.
 */
function backupStateSignature(state: BackupState): string {
  const ordered = <T extends [string | number, ...(string | number)[]]>(values: T[]): T[] =>
    values.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify({
    projects: ordered(state.projects),
    entries: ordered(state.entries),
    contacts: ordered(state.contacts),
    presets: ordered(state.presets),
    settings: ordered(state.settings),
    tombstones: ordered(state.tombstones),
  });
}

function backupStateFromRows(rows: BackupStateRows): BackupState {
  return {
    projects: rows.projects.map((project) => [
      project.uid,
      project.updatedAt ?? project.createdAt,
    ]),
    entries: rows.entries.map((entry) => [
      entry.uid,
      entry.updatedAt,
      entry.syncRevision ?? legacyEntryRevision(entry),
    ]),
    contacts: rows.contacts.map((contact) => [contact.uid, contact.updatedAt]),
    presets: rows.presets.map((preset) => [preset.id ?? 0, preset.uses, preset.updatedAt]),
    settings: rows.settings.map((setting) => [setting.key, setting.updatedAt ?? 0]),
    tombstones: rows.tombstones.map((stone) => [
      `${stone.table}:${stone.uid}`,
      stone.deletedAt,
      stone.entryRevision ?? '',
    ]),
  };
}

async function readBackupRows(): Promise<BackupStateRows> {
  /*
   * One readonly transaction gives the file and its fingerprint the same point
   * in time. Photo conversion happens after it commits, over structured clones;
   * a later edit therefore produces a different current fingerprint instead of
   * being accidentally marked as part of the file already on disk.
   */
  return db.transaction(
    'r',
    [db.projects, db.entries, db.presets, db.contacts, db.settings, db.tombstones],
    async () => {
      const [projects, entries, presets, contacts, settings, tombstones] = await Promise.all([
        db.projects.toArray(),
        db.entries.toArray(),
        db.presets.toArray(),
        db.contacts.toArray(),
        db.settings.where('key').anyOf([...SYNCED_SETTINGS]).toArray(),
        db.tombstones.toArray(),
      ]);
      return { projects, entries, presets, contacts, settings, tombstones };
    },
  );
}

/** The database fingerprint used to decide whether an automatic copy is due. */
export async function currentBackupStateSignature(): Promise<string> {
  /*
   * Keep this path cheap: unlike a backup itself, checking for change must not
   * deserialize every photograph. The three large/synced tables expose exactly
   * the identity-and-stamp pairs this signature needs through compound indexes.
   */
  return db.transaction(
    'r',
    [db.projects, db.entries, db.presets, db.contacts, db.settings, db.tombstones],
    async () => {
      const [projectKeys, entryKeys, contactKeys, presets, settings, tombstones] =
        await Promise.all([
          db.projects.orderBy('[uid+updatedAt]').keys(),
          db.entries.orderBy('[uid+updatedAt+syncRevision]').keys(),
          db.contacts.orderBy('[uid+updatedAt]').keys(),
          db.presets.toArray(),
          db.settings.where('key').anyOf([...SYNCED_SETTINGS]).toArray(),
          db.tombstones.toArray(),
        ]);
      const stamps = (keys: unknown[]) =>
        (keys as [IDBValidKey, IDBValidKey][]).map(([uid, updatedAt]) => [
          String(uid),
          Number(updatedAt),
        ] as [string, number]);
      const entryStamps = (entryKeys as unknown as [IDBValidKey, IDBValidKey, IDBValidKey][])
        .map(([uid, updatedAt, syncRevision]) => [
          String(uid),
          Number(updatedAt),
          String(syncRevision),
        ] as [string, number, string]);
      return backupStateSignature({
        projects: stamps(projectKeys),
        entries: entryStamps,
        contacts: stamps(contactKeys),
        settings: settings.map((setting) => [setting.key, setting.updatedAt ?? 0]),
        tombstones: tombstones.map((stone) => [
          `${stone.table}:${stone.uid}`,
          stone.deletedAt,
          stone.entryRevision ?? '',
        ]),
        presets: presets.map((preset) => [preset.id ?? 0, preset.uses, preset.updatedAt]),
      });
    },
  );
}

export interface BackupSnapshot {
  json: string;
  /** Fingerprint of the exact transaction represented by `json`. */
  stateSignature: string;
}

/** Builds one coherent backup after first committing every mounted editor. */
export async function createBackupSnapshot(options: { flush?: boolean } = {}): Promise<BackupSnapshot> {
  if (options.flush !== false) await flushPendingWrites();
  const rows = await readBackupRows();
  const { projects, entries, presets, contacts, settings } = rows;

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
    settings,
    entries: serialisedEntries,
  };
  const json = JSON.stringify(file);
  log.info('backup written', {
    projects: projects.length,
    entries: entries.length,
    contacts: contacts.length,
    settings: settings.length,
    photos: serialisedEntries.reduce((n, e) => n + e.photos.length, 0),
    bytes: json.length,
  });
  return { json, stateSignature: backupStateSignature(backupStateFromRows(rows)) };
}

export async function backupToJson(): Promise<string> {
  return (await createBackupSnapshot()).json;
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
      /*
       * A device clock can move backwards, and a peer deletion can carry a
       * timestamp ahead of this device's `Date.now()`. Restore must still be a
       * later write than every mutation this device already knows about, or the
       * next merge can immediately delete what was just restored. Read the
       * maxima inside this transaction, before clearing anything, and advance
       * one tick past both the local diary and the backup itself.
       */
      const [lastProject, localEntries, lastContact, localTombstones, localSettings] = await Promise.all([
        db.projects.orderBy('updatedAt').reverse().first(),
        db.entries.toArray(),
        db.contacts.orderBy('updatedAt').reverse().first(),
        db.tombstones.toArray(),
        db.settings.where('key').anyOf([...SYNCED_SETTINGS]).toArray(),
      ]);
      const backupMax = Math.max(
        0,
        ...parsed.projects.map((project) => project.updatedAt ?? project.createdAt ?? 0),
        ...entries.map((entry) => entry.updatedAt ?? 0),
        ...(parsed.contacts ?? []).map((contact) => contact.updatedAt ?? 0),
        ...(parsed.settings ?? []).map((setting) => setting.updatedAt ?? 0),
      );
      const restoredAt =
        Math.max(
          Date.now(),
          backupMax,
          lastProject?.updatedAt ?? lastProject?.createdAt ?? 0,
          ...localEntries.map((entry) => entry.updatedAt ?? 0),
          lastContact?.updatedAt ?? 0,
          ...localTombstones.map((stone) => stone.deletedAt ?? 0),
          ...localSettings.map((setting) => setting.updatedAt ?? 0),
        ) + 1;

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
      // Every restored record gets the same fresh stamp: restore is the last
      // write, including for project details that older backups did not stamp.
      const uidByProjectId = new Map<number | undefined, string>();
      const localEntryByUid = new Map(localEntries.map((entry) => [entry.uid, entry]));
      const localEntryStoneByUid = new Map(
        localTombstones
          .filter((stone) => stone.table === 'entries')
          .map((stone) => [stone.uid, stone]),
      );
      const projects = parsed.projects.map((project) => {
        const uid = project.uid ?? newUid();
        uidByProjectId.set(project.id, uid);
        return { ...project, uid, updatedAt: restoredAt };
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
      await db.entries.bulkAdd(
        entries.map((entry) => {
          const restoredUid = entry.uid ?? newUid();
          const restored: DiaryEntry = {
            ...entry,
            uid: restoredUid,
            projectUid: entry.projectUid || uidByProjectId.get(entry.projectId) || '',
            updatedAt: restoredAt,
          };
          restored.syncRevision = advanceEntryRevision(
            restored,
            entry.syncRevision,
            undefined,
            [
              localEntryByUid.get(restoredUid)?.syncRevision,
              localEntryStoneByUid.get(restoredUid)?.entryRevision,
            ],
          );
          return restored;
        }),
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
      // Restore diary-owned settings while leaving this device's local choices
      // (active project, view, pairing and similar state) alone. Unknown keys in
      // a hand-edited backup are ignored rather than gaining a restore path.
      if (parsed.settings !== undefined) {
        const backedByKey = new Map(
          parsed.settings
            .filter((setting) => (SYNCED_SETTINGS as readonly string[]).includes(setting.key))
            .map((setting) => [setting.key, setting] as const),
        );
        // Presence of the array marks the new backup shape. A missing key in
        // that array means the backed-up diary used its default/cleared value;
        // write an explicit null so an older value on this device cannot leak
        // into the restored diary or return from the peer on the next sync.
        await db.settings.bulkPut(
          SYNCED_SETTINGS.map((key) => ({
            key,
            value: backedByKey.get(key)?.value ?? null,
            updatedAt: restoredAt,
          })),
        );
      }
      const first = parsed.projects.find((p) => !p.archived) ?? parsed.projects[0];
      await setSetting(ACTIVE_PROJECT_KEY, first?.id ?? null);
    },
  );

  log.info('backup restored', {
    projects: parsed.projects.length,
    entries: entries.length,
    contacts: parsed.contacts?.length ?? 0,
    settings: parsed.settings?.length ?? 0,
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
