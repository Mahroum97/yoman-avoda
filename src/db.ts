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
} from './types';
import { emptyCasting } from './types';
import { blobToDataUrl, dataUrlToBlob } from './lib/images';
import { isoDate } from './lib/dates';

/** Small key/value bag for app state that must outlive a reload. */
export interface Setting {
  key: string;
  value: unknown;
}

class YomanDb extends Dexie {
  projects!: Table<Project, number>;
  entries!: Table<DiaryEntry, number>;
  presets!: Table<Preset, number>;
  settings!: Table<Setting, string>;

  constructor() {
    super('yoman-avoda');
    this.version(1).stores({
      projects: '++id, name, archived, createdAt',
      // [projectId+date] enforces one page per project per day.
      entries: '++id, projectId, date, [projectId+date], status, updatedAt',
      presets: '++id, kind, [kind+value], uses',
      settings: 'key',
    });
  }
}

export const db = new YomanDb();

/* ------------------------------------------------------------------ settings */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export const ACTIVE_PROJECT_KEY = 'activeProjectId';

/* ------------------------------------------------------------------ projects */

export async function createProject(
  data: Omit<Project, 'id' | 'createdAt' | 'archived'>,
): Promise<number> {
  const id = await db.projects.add({
    ...data,
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
  await db.transaction('rw', db.projects, db.entries, db.settings, async () => {
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

export function blankEntry(projectId: number, date = isoDate()): DiaryEntry {
  const now = Date.now();
  return {
    projectId,
    date,
    weather: '',
    management: [],
    contractors: [],
    equipment: [],
    workDescription: '',
    casting: emptyCasting(),
    supervisorNotes: '',
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

export async function saveEntry(entry: DiaryEntry): Promise<number> {
  const toSave: DiaryEntry = { ...entry, updatedAt: Date.now() };
  const id = await db.entries.put(toSave);
  await learnPresets(toSave);
  return id;
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
  const fresh = blankEntry(source.projectId, date);
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
      await db.projects.bulkAdd(parsed.projects);
      await db.entries.bulkAdd(entries);
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
