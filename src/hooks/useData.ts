/** Live views over IndexedDB. Every hook re-renders when the data changes. */
import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Contact, Preset, PresetKind, Project } from '../types';
import { ACTIVE_PROJECT_KEY, db, getSetting, setSetting } from '../db';

export function useProjects(): Project[] | undefined {
  return useLiveQuery(() => db.projects.orderBy('createdAt').toArray(), []);
}

export interface ActiveProject {
  project?: Project;
  projectId?: number;
  loading: boolean;
}

export function useActiveProject(): ActiveProject {
  const result = useLiveQuery(async () => {
    const id = await getSetting<number | null>(ACTIVE_PROJECT_KEY, null);
    const stored = id === null ? undefined : await db.projects.get(id);
    if (stored) return { project: stored, projectId: stored.id, stale: false };

    /*
     * Either nothing was chosen yet, or the stored id points at a project that
     * no longer exists — after a restore, or when the other device deleted it
     * and the deletion arrived by sync. Falling back here is what stops the app
     * showing "no projects yet" while projects exist.
     */
    const first = await db.projects.filter((p) => !p.archived).first();
    return { project: first, projectId: first?.id, stale: first?.id !== undefined };
  }, []);

  /*
   * Healing the stored pointer has to happen out here: a live query runs inside
   * a read transaction, and writing from within one throws.
   */
  const staleId = result?.stale ? result.projectId : undefined;
  useEffect(() => {
    if (staleId !== undefined) void setActiveProject(staleId);
  }, [staleId]);

  return {
    project: result?.project,
    projectId: result?.projectId,
    loading: result === undefined,
  };
}

export async function setActiveProject(id: number): Promise<void> {
  await setSetting(ACTIVE_PROJECT_KEY, id);
}

export type PresetMap = Record<PresetKind, string[]>;

const EMPTY_PRESETS: PresetMap = {
  staff: [],
  role: [],
  trade: [],
  equipment: [],
  weather: [],
  concreteType: [],
};

/** All remembered values, most-used first, grouped by kind. */
export function usePresets(): PresetMap {
  const rows = useLiveQuery(() => db.presets.toArray(), []);
  if (!rows) return EMPTY_PRESETS;

  const map: PresetMap = {
    staff: [],
    role: [],
    trade: [],
    equipment: [],
    weather: [],
    concreteType: [],
  };
  const sorted = [...rows].sort(
    (a, b) => b.uses - a.uses || a.value.localeCompare(b.value, 'he'),
  );
  for (const row of sorted) map[row.kind]?.push(row.value);
  return map;
}

export function usePresetRows(): Preset[] | undefined {
  return useLiveQuery(
    () =>
      db.presets
        .toArray()
        .then((rows) =>
          rows.sort(
            (a, b) =>
              a.kind.localeCompare(b.kind) ||
              b.uses - a.uses ||
              a.value.localeCompare(b.value, 'he'),
          ),
        ),
    [],
  );
}

export function useEntries(projectId?: number) {
  return useLiveQuery(async () => {
    if (projectId === undefined) return [];
    const rows = await db.entries.where('projectId').equals(projectId).toArray();
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }, [projectId]);
}

/**
 * ספקים וקבלנים, in the order they were added.
 *
 * Insertion order rather than alphabetical on purpose: the row number beside
 * each line is a position in this list, and a list that reorders itself while
 * you type into it is unusable.
 */
export function useContacts(): Contact[] | undefined {
  return useLiveQuery(
    () => db.contacts.toArray().then((rows) => rows.sort((a, b) => a.createdAt - b.createdAt)),
    [],
  );
}

export function useEntry(id?: number) {
  return useLiveQuery(async () => (id === undefined ? undefined : db.entries.get(id)), [id]);
}
