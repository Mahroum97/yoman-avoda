/** Live views over IndexedDB. Every hook re-renders when the data changes. */
import { useLiveQuery } from 'dexie-react-hooks';
import type { Preset, PresetKind, Project } from '../types';
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
    if (id === null) {
      // Fall back to any project, so a fresh restore is immediately usable.
      const first = await db.projects.filter((p) => !p.archived).first();
      return { project: first, projectId: first?.id };
    }
    const project = await db.projects.get(id);
    return { project, projectId: project?.id };
  }, []);

  return { ...(result ?? {}), loading: result === undefined };
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

export function useEntry(id?: number) {
  return useLiveQuery(async () => (id === undefined ? undefined : db.entries.get(id)), [id]);
}
