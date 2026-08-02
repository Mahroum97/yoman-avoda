/**
 * Local-first storage. Everything lives in IndexedDB on this device — the app
 * works with no network at all on site. `backupToJson` / `restoreFromJson` are
 * the safety net, since there is no server copy.
 */
import Dexie, { type Table } from 'dexie';
import type {
  DiaryEntry,
  Preset,
  PresetKind,
  Project,
  Tombstone,
} from './types';
import { emptyCasting } from './types';
import type { LogEntry } from './lib/log';
import { uid as newUid } from './lib/id';
import { blobToDataUrl, dataUrlToBlob } from './lib/images';
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
  }
}

export const db = new YomanDb();

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
  return id;
}

/** Deletes a project and every diary page under it. */
export async function deleteProject(id: number): Promise<void> {
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
    const active = await getSetting<number | null>(ACTIVE_PROJECT_KEY, null);
    if (active === id) {
      const next = await db.projects.filter((p) => !p.archived).first();
      await setSetting(ACTIVE_PROJECT_KEY, next?.id ?? null);
    }
  });
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

export async function findEntryByDate(
  projectId: number,
  date: string,
): Promise<DiaryEntry | undefined> {
  return db.entries.where({ projectId, date }).first();
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
    status: statusFor(entry),
    updatedAt: Date.now(),
  };
  const id = await db.entries.put(toSave);
  await learnPresets(toSave);
  return id;
}

/** Deletes one diary page, recording it so the deletion syncs. */
export async function deleteEntry(id: number): Promise<void> {
  await db.transaction('rw', db.entries, db.tombstones, async () => {
    const entry = await db.entries.get(id);
    if (entry) {
      await db.tombstones.put({ uid: entry.uid, table: 'entries', deletedAt: Date.now() });
    }
    await db.entries.delete(id);
  });
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
    .filter((e) => e.projectId === projectId)
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
  /** Photos travel as data URLs, since JSON cannot hold a Blob. */
  entries: (Omit<DiaryEntry, 'photos'> & {
    photos: (Omit<import('./types').Photo, 'blob'> & { dataUrl: string })[];
  })[];
}

export async function backupToJson(): Promise<string> {
  const [projects, entries, presets] = await Promise.all([
    db.projects.toArray(),
    db.entries.toArray(),
    db.presets.toArray(),
  ]);

  const serialisedEntries = await Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      photos: await Promise.all(
        entry.photos.map(async ({ blob, ...rest }) => ({
          ...rest,
          dataUrl: await blobToDataUrl(blob),
        })),
      ),
    })),
  );

  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    projects,
    presets,
    entries: serialisedEntries,
  };
  return JSON.stringify(file);
}

export interface RestoreResult {
  projects: number;
  entries: number;
}

/** Replaces all local data with the contents of a backup file. */
export async function restoreFromJson(json: string): Promise<RestoreResult> {
  const parsed = JSON.parse(json) as BackupFile;
  if (parsed.format !== BACKUP_FORMAT) {
    throw new Error('הקובץ אינו קובץ גיבוי של יומן עבודה');
  }
  if (parsed.version > BACKUP_VERSION) {
    throw new Error('הגיבוי נוצר בגרסה חדשה יותר של האפליקציה');
  }

  const entries: DiaryEntry[] = await Promise.all(
    parsed.entries.map(async (entry) => ({
      ...entry,
      photos: await Promise.all(
        entry.photos.map(async ({ dataUrl, ...rest }) => ({
          ...rest,
          blob: await dataUrlToBlob(dataUrl),
        })),
      ),
    })),
  );

  await db.transaction(
    'rw',
    db.projects,
    db.entries,
    db.presets,
    db.settings,
    async () => {
      await Promise.all([
        db.projects.clear(),
        db.entries.clear(),
        db.presets.clear(),
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
      await db.entries.bulkAdd(
        entries.map((entry) => ({
          ...entry,
          uid: entry.uid ?? newUid(),
          projectUid: entry.projectUid || uidByProjectId.get(entry.projectId) || '',
        })),
      );
      await db.presets.bulkAdd(parsed.presets);
      const first = parsed.projects.find((p) => !p.archived) ?? parsed.projects[0];
      await setSetting(ACTIVE_PROJECT_KEY, first?.id ?? null);
    },
  );

  return { projects: parsed.projects.length, entries: entries.length };
}

/** Rough on-device footprint, shown in Settings. */
export async function estimateUsage(): Promise<{ used: number; quota: number }> {
  if (!navigator.storage?.estimate) return { used: 0, quota: 0 };
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { used: usage, quota };
}
