/**
 * Turns the local diary into something that can travel, and merges what comes
 * back. Both devices run exactly this code — there is no "server copy".
 */
import type { DiaryEntry, Project } from '../types';
import { db, getSetting } from '../db';
import { blobToDataUrl, dataUrlToBlob } from '../lib/images';
import { uid as newUid } from '../lib/id';
import {
  SYNCED_SETTINGS,
  SYNC_PROTOCOL_VERSION,
  type SyncManifest,
  type SyncPayload,
  type SyncRequest,
  type WireEntry,
  type WireProject,
} from './protocol';

/** How long a tombstone is kept before it is assumed to have reached everyone. */
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export async function buildManifest(deviceName: string): Promise<SyncManifest> {
  const [projects, entries, presets, tombstones, settings] = await Promise.all([
    db.projects.toArray(),
    db.entries.toArray(),
    db.presets.toArray(),
    db.tombstones.toArray(),
    db.settings.toArray(),
  ]);

  return {
    version: SYNC_PROTOCOL_VERSION,
    deviceName,
    projects: projects.map((p) => ({ uid: p.uid, updatedAt: p.createdAt })),
    entries: entries.map((e) => ({ uid: e.uid, updatedAt: e.updatedAt })),
    presets: presets.map((p) => ({
      key: `${p.kind} ${p.value}`,
      uses: p.uses,
      updatedAt: p.updatedAt,
    })),
    tombstones: tombstones.map((t) => ({ ...t })),
    settings: settings
      .filter((s) => (SYNCED_SETTINGS as readonly string[]).includes(s.key))
      .map((s) => ({ key: s.key, updatedAt: s.updatedAt ?? 0 })),
  };
}

/** Collects exactly the records the other side asked for. */
export async function collectPayload(request: SyncRequest): Promise<SyncPayload> {
  const projects = await db.projects.where('uid').anyOf(request.projects).toArray();
  const entries = await db.entries.where('uid').anyOf(request.entries).toArray();
  const presets = await db.presets.toArray();
  const tombstones = await db.tombstones.toArray();

  const settings = (
    await Promise.all(
      request.settings.map(async (key) => {
        const row = await db.settings.get(key);
        return row ? { key, value: row.value, updatedAt: row.updatedAt ?? 0 } : null;
      }),
    )
  ).filter((row): row is { key: string; value: unknown; updatedAt: number } => row !== null);

  return {
    projects: projects.map(toWireProject),
    entries: await Promise.all(entries.map(toWireEntry)),
    // Presets are tiny and merge by taking the larger count, so send them all.
    presets: presets.map((p) => ({
      kind: p.kind,
      value: p.value,
      uses: p.uses,
      updatedAt: p.updatedAt,
    })),
    settings,
    tombstones: tombstones.map((t) => ({ ...t })),
  };
}

function toWireProject(project: Project): WireProject {
  return {
    uid: project.uid,
    name: project.name,
    address: project.address,
    company: project.company,
    archived: project.archived,
    createdAt: project.createdAt,
    // Projects have no updatedAt of their own; createdAt is stable and edits
    // are rare, so it doubles as the version stamp.
    updatedAt: project.createdAt,
  };
}

async function toWireEntry(entry: DiaryEntry): Promise<WireEntry> {
  return {
    uid: entry.uid,
    projectUid: entry.projectUid,
    date: entry.date,
    weather: entry.weather,
    management: entry.management,
    contractors: entry.contractors,
    equipment: entry.equipment,
    workDescription: entry.workDescription,
    casting: entry.casting,
    supervisorNotes: entry.supervisorNotes,
    supervisorSignature: entry.supervisorSignature,
    managerSignature: entry.managerSignature,
    photos: await Promise.all(
      entry.photos.map(async (photo) => ({
        id: photo.id,
        caption: photo.caption,
        width: photo.width,
        height: photo.height,
        takenAt: photo.takenAt,
        dataUrl: await blobToDataUrl(photo.blob),
      })),
    ),
    status: entry.status,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export interface ApplyResult {
  projects: number;
  entries: number;
  deleted: number;
}

/**
 * Merges a payload into the local diary.
 *
 * Order matters: tombstones are applied first, so a record deleted on the other
 * device does not get written and then removed, and projects before entries so
 * an incoming entry can always find its project's local id.
 */
export async function applyPayload(payload: SyncPayload): Promise<ApplyResult> {
  const result: ApplyResult = { projects: 0, entries: 0, deleted: 0 };

  // --- deletions
  for (const stone of payload.tombstones) {
    const existing = await db.tombstones.get(stone.uid);
    if (!existing || existing.deletedAt < stone.deletedAt) {
      await db.tombstones.put(stone);
    }
    if (stone.table === 'entries') {
      const entry = await db.entries.where('uid').equals(stone.uid).first();
      if (entry?.id !== undefined && entry.updatedAt <= stone.deletedAt) {
        await db.entries.delete(entry.id);
        result.deleted += 1;
      }
    } else {
      const project = await db.projects.where('uid').equals(stone.uid).first();
      if (project?.id !== undefined) {
        await db.entries.where('projectId').equals(project.id).delete();
        await db.projects.delete(project.id);
        result.deleted += 1;
      }
    }
  }

  /*
   * Both sides' tombstones matter, not just the incoming ones. A record we
   * deleted can still arrive from a peer that has not heard about the deletion
   * yet; without this it would quietly come back to life. A record edited on
   * the other device *after* our deletion does return, which is the same
   * last-write-wins rule applied to deletes.
   */
  const localStones = await db.tombstones.toArray();
  const deletedAt = new Map<string, number>();
  for (const stone of [...localStones, ...payload.tombstones]) {
    const key = `${stone.table}:${stone.uid}`;
    deletedAt.set(key, Math.max(deletedAt.get(key) ?? 0, stone.deletedAt));
  }
  const isDeleted = (table: 'projects' | 'entries', uid: string, updatedAt: number) =>
    (deletedAt.get(`${table}:${uid}`) ?? -1) >= updatedAt;

  // --- projects
  for (const wire of payload.projects) {
    if (isDeleted('projects', wire.uid, wire.updatedAt)) continue;
    const existing = await db.projects.where('uid').equals(wire.uid).first();
    const record: Project = {
      uid: wire.uid,
      name: wire.name,
      address: wire.address,
      company: wire.company,
      archived: wire.archived,
      createdAt: wire.createdAt,
    };
    if (existing?.id === undefined) {
      await db.projects.add(record);
    } else {
      await db.projects.update(existing.id, record);
    }
    result.projects += 1;
  }

  // --- entries
  for (const wire of payload.entries) {
    if (isDeleted('entries', wire.uid, wire.updatedAt)) continue;
    const project = await db.projects.where('uid').equals(wire.projectUid).first();
    // An entry whose project never arrived would be unreachable in the UI.
    if (project?.id === undefined) continue;

    const existing = await db.entries.where('uid').equals(wire.uid).first();
    if (existing && existing.updatedAt >= wire.updatedAt) continue;

    // One page per project per day: an entry arriving for a date that already
    // has a different page replaces it, since the newer stamp wins.
    const clash = await db.entries.where({ projectId: project.id, date: wire.date }).first();
    if (clash?.id !== undefined && clash.uid !== wire.uid) {
      if (clash.updatedAt > wire.updatedAt) continue;
      await db.entries.delete(clash.id);
    }

    const entry: DiaryEntry = {
      id: existing?.id,
      uid: wire.uid,
      projectUid: wire.projectUid,
      projectId: project.id,
      date: wire.date,
      weather: wire.weather,
      management: wire.management as DiaryEntry['management'],
      contractors: wire.contractors as DiaryEntry['contractors'],
      equipment: wire.equipment as DiaryEntry['equipment'],
      workDescription: wire.workDescription,
      casting: wire.casting as DiaryEntry['casting'],
      supervisorNotes: wire.supervisorNotes,
      supervisorSignature: wire.supervisorSignature,
      managerSignature: wire.managerSignature,
      photos: await Promise.all(
        wire.photos.map(async (photo) => ({
          id: photo.id || newUid(),
          caption: photo.caption,
          width: photo.width,
          height: photo.height,
          takenAt: photo.takenAt,
          blob: await dataUrlToBlob(photo.dataUrl),
        })),
      ),
      status: wire.status,
      createdAt: wire.createdAt,
      updatedAt: wire.updatedAt,
    };
    await db.entries.put(entry);
    result.entries += 1;
  }

  // --- presets: keep whichever side used a value more
  for (const wire of payload.presets) {
    const existing = await db.presets
      .where({ kind: wire.kind, value: wire.value })
      .first();
    if (existing?.id === undefined) {
      await db.presets.add({
        kind: wire.kind as never,
        value: wire.value,
        uses: wire.uses,
        updatedAt: wire.updatedAt,
      });
    } else if (wire.uses > existing.uses) {
      await db.presets.update(existing.id, {
        uses: wire.uses,
        updatedAt: Math.max(existing.updatedAt, wire.updatedAt),
      });
    }
  }

  // --- shared settings
  for (const wire of payload.settings) {
    const existing = await db.settings.get(wire.key);
    if (!existing || (existing.updatedAt ?? 0) < wire.updatedAt) {
      await db.settings.put({ key: wire.key, value: wire.value, updatedAt: wire.updatedAt });
    }
  }

  // An active project may have been deleted by the other device.
  const activeId = await getSetting<number | null>('activeProjectId', null);
  if (activeId !== null && !(await db.projects.get(activeId))) {
    const next = await db.projects.filter((p) => !p.archived).first();
    await db.settings.put({ key: 'activeProjectId', value: next?.id ?? null });
  }

  await pruneTombstones();
  return result;
}

/** Old tombstones would otherwise grow without bound. */
async function pruneTombstones(): Promise<void> {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  await db.tombstones.filter((t) => t.deletedAt < cutoff).delete();
}
