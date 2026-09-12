/**
 * Turns the local diary into something that can travel, and merges what comes
 * back. Both devices run exactly this code — there is no "server copy".
 */
import type { Contact, DiaryEntry, Project, TombstoneTable } from '../types';
import { db, getSetting } from '../db';
import { bytesToDataUrl, dataUrlToBytes, photoBytes } from '../lib/photoData';
import { uid as newUid } from '../lib/id';
import { preserveContractorIdentities } from '../lib/reportFields';
import { logger } from '../lib/log';
import {
  SYNCED_SETTINGS,
  SYNC_PROTOCOL_VERSION,
  type SyncManifest,
  type SyncPayload,
  type SyncRequest,
  type WireContact,
  type WireEntry,
  type WireProject,
} from './protocol';
import {
  compareEntryRevisions,
  mergeEntryDeletionRevisions,
  mergeEquivalentEntryRevisions,
  revisionWinner,
  stableConflictBranchUid,
  validatedEntryRevision,
} from './revision';

/** How long a tombstone is kept before it is assumed to have reached everyone. */
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const log = logger('sync-store');

const conflictGroupFor = (...uids: string[]): string =>
  `conflict:${[...uids].sort().join(':')}`;

/**
 * A stamp list read from an index rather than from the records.
 *
 * `keys()` on a compound index yields `[uid, updatedAt]` pairs straight out of
 * the index, so the record bodies — and with them every photo Blob — are never
 * deserialised. This is the difference between a manifest costing kilobytes and
 * costing the whole diary, and a manifest is built twice on every sync.
 */
async function stampsFrom(
  table: typeof db.entries | typeof db.projects | typeof db.contacts,
  index: string,
): Promise<{ uid: string; updatedAt: number }[]> {
  const keys = (await table.orderBy(index).keys()) as unknown as [string, number][];
  return keys.map(([uid, updatedAt]) => ({ uid, updatedAt }));
}

async function entryStamps(): Promise<SyncManifest['entries']> {
  const keys = (await db.entries
    .orderBy('[uid+updatedAt+syncRevision]')
    .keys()) as unknown as [string, number, string][];
  return keys.map(([uid, updatedAt, syncRevision]) => ({
    uid,
    updatedAt,
    syncRevision,
  }));
}

export async function buildManifest(deviceName: string): Promise<SyncManifest> {
  const [projects, entries, contacts, presets, tombstones, settings] = await Promise.all([
    stampsFrom(db.projects, '[uid+updatedAt]'),
    entryStamps(),
    stampsFrom(db.contacts, '[uid+updatedAt]'),
    db.presets.toArray(),
    db.tombstones.toArray(),
    db.settings.toArray(),
  ]);

  return {
    version: SYNC_PROTOCOL_VERSION,
    deviceName,
    projects,
    entries,
    contacts,
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

/**
 * Roughly how much JSON one request should carry.
 *
 * Photos travel as base64, so a handful of entries can be tens of megabytes.
 * Sending the diary in one body meant building that whole string in memory on
 * the phone, holding it again to send it, and the Mac holding it a third time
 * to forward it over IPC — which is where a sync with real photos died. Chunks
 * keep every step bounded no matter how large the diary grows.
 */
const CHUNK_BYTES = 4 * 1024 * 1024;
const CHUNK_MAX_ENTRIES = 12;

/**
 * The next batch of entries to send, starting at `from`.
 *
 * At least one entry always goes into a batch even if it alone blows the
 * budget, so a diary page with a lot of photos cannot stall the loop.
 */
export async function collectEntryChunk(
  uids: string[],
  from: number,
): Promise<{ entries: WireEntry[]; next: number; bytes: number }> {
  const entries: WireEntry[] = [];
  let bytes = 0;
  let index = from;

  while (index < uids.length && entries.length < CHUNK_MAX_ENTRIES && bytes < CHUNK_BYTES) {
    const record = await db.entries.where('uid').equals(uids[index]).first();
    index += 1;
    if (!record) continue;
    const wire = await toWireEntry(record);
    bytes += wire.photos.reduce((n, photo) => n + photo.dataUrl.length, 0) + 1024;
    entries.push(wire);
  }

  return { entries, next: index, bytes };
}

/** Collects exactly the records the other side asked for. */
export async function collectPayload(request: SyncRequest): Promise<SyncPayload> {
  const projects = await db.projects.where('uid').anyOf(request.projects).toArray();
  const entries = await db.entries.where('uid').anyOf(request.entries).toArray();
  const contacts = await db.contacts.where('uid').anyOf(request.contacts ?? []).toArray();
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
    // No chunking: a line is a few hundred bytes, and the whole book is smaller
    // than one photo. It rides along with the metadata rather than in the
    // weighed entry chunks.
    contacts: contacts.map(toWireContact),
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
    // Older backups predate project modification stamps. Their creation time is
    // the best version they have until v7 backfills and the next edit advances it.
    updatedAt: project.updatedAt ?? project.createdAt,
  };
}

function toWireContact(contact: Contact): WireContact {
  return {
    uid: contact.uid,
    name: contact.name,
    trade: contact.trade,
    phone: contact.phone,
    projects: contact.projects,
    notes: contact.notes,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
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
    receivedToday: entry.receivedToday ?? '',
    deliveryLedger: entry.deliveryLedger,
    supervisorSignature: entry.supervisorSignature,
    managerSignature: entry.managerSignature,
    photos: await Promise.all(
      entry.photos.map(async (photo) => {
        // A photo whose bytes cannot be read travels as an empty one rather
        // than failing the sync: one damaged picture must not stop a fortnight
        // of pages reaching the other device. `applyPayload` on the far side
        // refuses to overwrite a photo it can read with an empty one.
        const bytes = await photoBytes(photo);
        return {
          id: photo.id,
          caption: photo.caption,
          width: photo.width,
          height: photo.height,
          takenAt: photo.takenAt,
          dataUrl: bytes ? bytesToDataUrl(bytes) : '',
        };
      }),
    ),
    status: entry.status,
    pinned: entry.pinned ?? false,
    deletedAt: entry.deletedAt,
    syncConflict: entry.syncConflict,
    syncConflictKind: entry.syncConflictKind,
    syncConflictGroup: entry.syncConflictGroup,
    syncConflictRoot: entry.syncConflictRoot,
    syncRevision: validatedEntryRevision(entry),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/** Everything a payload carries apart from the entries, which travel chunked. */
export async function collectMeta(request: SyncRequest): Promise<SyncPayload> {
  return collectPayload({ ...request, entries: [] });
}

export interface SyncCounts {
  projects: number;
  entries: number;
  contacts: number;
  presets: number;
  settings: number;
  tombstones: number;
}

/** Counts every record class actually carried by one wire payload. */
export function countPayload(payload: SyncPayload): SyncCounts {
  return {
    projects: payload.projects.length,
    entries: payload.entries.length,
    contacts: payload.contacts?.length ?? 0,
    presets: payload.presets.length,
    settings: payload.settings.length,
    tombstones: payload.tombstones.length,
  };
}

export interface ApplyResult extends SyncCounts {
  /** Records physically removed while applying received tombstones. */
  deleted: number;
  /** Concurrent revision or delete/edit conflicts retained for review. */
  conflicts: number;
}

/**
 * Merges a payload into the local diary.
 *
 * Order matters: tombstones are applied first, so a record deleted on the other
 * device does not get written and then removed, and projects before entries so
 * an incoming entry can always find its project's local id.
 */
export async function applyPayload(payload: SyncPayload): Promise<ApplyResult> {
  /*
   * Photos are decoded before the transaction opens, not inside it.
   *
   * Two reasons, and both bite. A Dexie transaction commits as soon as it
   * awaits anything that is not a Dexie promise, so decoding inside it would
   * end the transaction underneath the writes that follow. And the merge used
   * to run every read and write as its own transaction — hundreds of them for
   * one sync — which was slower than the network it was waiting on.
   */
  const decoded = new Map<string, DiaryEntry['photos']>();
  for (const wire of payload.entries) {
    decoded.set(
      wire.uid,
      wire.photos.map((photo) => ({
        id: photo.id || newUid(),
        caption: photo.caption,
        width: photo.width,
        height: photo.height,
        takenAt: photo.takenAt,
        bytes: dataUrlToBytes(photo.dataUrl),
      })),
    );
  }

  const result = await db.transaction(
    'rw',
    [db.projects, db.entries, db.contacts, db.presets, db.settings, db.tombstones],
    () => mergeInTransaction(payload, decoded),
  );
  if (result.conflicts > 0) {
    log.warn('kept concurrent diary revisions for review', {
      conflicts: result.conflicts,
    });
  }
  return result;
}

/**
 * An incoming photo never replaces one we can still read with one we cannot.
 *
 * Last write wins is right for a page: one person, two devices, the later edit
 * is the one they meant. It is wrong for the picture inside it. A device whose
 * stored photographs have been damaged — which is what an app reinstall used to
 * do on iOS — would otherwise carry that damage across on its next sync and
 * overwrite the only good copy left, and the newer stamp would make it look
 * deliberate. The caption and the position still come from the newer page; only
 * the bytes are kept.
 */
function keepReadablePhotos(
  incoming: DiaryEntry['photos'],
  existing: DiaryEntry['photos'] | undefined,
): DiaryEntry['photos'] {
  if (!existing?.length) return incoming;
  const mine = new Map(existing.map((photo) => [photo.id, photo]));
  return incoming.map((photo) => {
    if (photo.bytes && photo.bytes.byteLength > 0) return photo;
    const held = mine.get(photo.id);
    if (!held) return photo;
    if (held.bytes && held.bytes.byteLength > 0) return { ...photo, bytes: held.bytes };
    return held.blob ? { ...photo, blob: held.blob } : photo;
  });
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
    // A 128-bit identity collision must stop the merge, never overwrite an
    // unrelated preserved branch. The transaction abort leaves both originals.
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

async function preserveConcurrentBranches(
  existing: DiaryEntry,
  incoming: DiaryEntry,
  localRevision: string,
  remoteRevision: string,
): Promise<void> {
  const rootUid =
    existing.syncConflictRoot ?? incoming.syncConflictRoot ?? existing.uid;
  const group =
    existing.syncConflictGroup ?? incoming.syncConflictGroup ?? `revision:${rootUid}`;
  const local: DiaryEntry = {
    ...existing,
    syncRevision: localRevision,
    syncConflict: true,
    syncConflictKind: 'revision',
    syncConflictGroup: group,
    syncConflictRoot: rootUid,
  };
  const remote: DiaryEntry = {
    ...incoming,
    syncRevision: remoteRevision,
    syncConflict: true,
    syncConflictKind: 'revision',
    syncConflictGroup: group,
    syncConflictRoot: rootUid,
  };

  if (revisionWinner(localRevision, remoteRevision) === 'local') {
    await putStableConflictBranch(remote, rootUid, group);
    await db.entries.put({
      ...local,
      id: existing.id,
      uid: existing.uid,
      updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
    });
  } else {
    await putStableConflictBranch(local, rootUid, group);
    await db.entries.put({
      ...remote,
      id: existing.id,
      uid: existing.uid,
      updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
    });
  }
}

async function mergeInTransaction(
  payload: SyncPayload,
  decoded: Map<string, DiaryEntry['photos']>,
): Promise<ApplyResult> {
  const result: ApplyResult = {
    projects: 0,
    entries: 0,
    contacts: 0,
    presets: 0,
    settings: 0,
    tombstones: 0,
    deleted: 0,
    conflicts: 0,
  };

  // --- deletions
  for (const incomingStone of payload.tombstones) {
    const existing = await db.tombstones.get(incomingStone.uid);
    let stone = incomingStone;
    let shouldStore = !existing || existing.deletedAt < incomingStone.deletedAt;
    if (
      existing?.table === 'entries' &&
      incomingStone.table === 'entries' &&
      existing.entryRevision &&
      incomingStone.entryRevision
    ) {
      const order = compareEntryRevisions(
        existing.entryRevision,
        incomingStone.entryRevision,
      );
      if (order === 'local-ahead' || order === 'same') {
        stone = existing;
        shouldStore = false;
      } else if (order === 'concurrent') {
        stone = {
          ...incomingStone,
          deletedAt: Math.max(existing.deletedAt, incomingStone.deletedAt),
          entryRevision:
            mergeEntryDeletionRevisions(
              existing.entryRevision,
              incomingStone.entryRevision,
            ) ?? incomingStone.entryRevision,
        };
        shouldStore = true;
      } else {
        shouldStore = true;
      }
    }
    if (shouldStore) {
      await db.tombstones.put(stone);
      result.tombstones += 1;
    }
    if (stone.table === 'entries') {
      const entry = await db.entries.where('uid').equals(stone.uid).first();
      if (entry?.id !== undefined) {
        const deletionOrder = stone.entryRevision
          ? compareEntryRevisions(
              validatedEntryRevision(entry),
              stone.entryRevision,
            )
          : entry.updatedAt <= stone.deletedAt
            ? 'remote-ahead'
            : 'local-ahead';
        if (deletionOrder === 'remote-ahead' || deletionOrder === 'same') {
          await db.entries.delete(entry.id);
          await clearResolvedConflict(entry, stone.deletedAt);
          result.deleted += 1;
        } else if (deletionOrder === 'concurrent') {
          await db.entries.update(entry.id, {
            syncConflict: true,
            syncConflictKind: 'deletion',
            syncConflictGroup: entry.syncConflictGroup ?? `deletion:${entry.uid}`,
            syncConflictRoot: entry.syncConflictRoot ?? entry.uid,
          });
          result.conflicts += 1;
        } else {
          // The live entry causally follows this deletion (explicit Keep or a
          // restore). Do not retain/rebroadcast the obsolete stone merely
          // because it hitched a ride in an unrelated metadata payload.
          await db.tombstones.delete(stone.uid);
        }
      }
    } else if (stone.table === 'contacts') {
      const contact = await db.contacts.where('uid').equals(stone.uid).first();
      if (contact?.id !== undefined && contact.updatedAt <= stone.deletedAt) {
        await db.contacts.delete(contact.id);
        result.deleted += 1;
      }
    } else if (stone.table === 'projects') {
      // Named rather than left as the `else`, so a table added later cannot
      // fall into the branch that deletes a project and every page under it.
      const project = await db.projects.where('uid').equals(stone.uid).first();
      const projectUpdatedAt = project?.updatedAt ?? project?.createdAt ?? -1;
      // A restored or edited project newer than the deletion survives, along
      // with its pages. Applying project stones unconditionally used to undo a
      // deliberate backup restore even though every restored page was newer.
      if (project?.id !== undefined && projectUpdatedAt <= stone.deletedAt) {
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
  const entryStones = new Map<string, (typeof localStones)[number]>();
  for (const stone of localStones) {
    const key = `${stone.table}:${stone.uid}`;
    deletedAt.set(key, Math.max(deletedAt.get(key) ?? 0, stone.deletedAt));
    if (stone.table === 'entries') {
      const held = entryStones.get(stone.uid);
      if (!held || held.deletedAt < stone.deletedAt) entryStones.set(stone.uid, stone);
    }
  }
  const isDeleted = (table: TombstoneTable, uid: string, updatedAt: number) =>
    (deletedAt.get(`${table}:${uid}`) ?? -1) >= updatedAt;

  // --- projects
  for (const wire of payload.projects) {
    const wireUpdatedAt = wire.updatedAt ?? wire.createdAt;
    if (isDeleted('projects', wire.uid, wireUpdatedAt)) continue;
    const existing = await db.projects.where('uid').equals(wire.uid).first();
    if ((existing?.updatedAt ?? existing?.createdAt ?? -1) >= wireUpdatedAt) continue;
    const record: Project = {
      uid: wire.uid,
      name: wire.name,
      address: wire.address,
      company: wire.company,
      archived: wire.archived,
      createdAt: wire.createdAt,
      updatedAt: wireUpdatedAt,
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
    const project = await db.projects.where('uid').equals(wire.projectUid).first();
    // An entry whose project never arrived would be unreachable in the UI.
    if (project?.id === undefined) continue;

    const existing = await db.entries.where('uid').equals(wire.uid).first();
    let entry: DiaryEntry = {
      id: existing?.id,
      uid: wire.uid,
      projectUid: wire.projectUid,
      projectId: project.id,
      date: wire.date,
      weather: wire.weather,
      management: wire.management as DiaryEntry['management'],
      contractors: preserveContractorIdentities(wire.contractors as DiaryEntry['contractors'], existing?.contractors),
      equipment: wire.equipment as DiaryEntry['equipment'],
      workDescription: wire.workDescription,
      casting: wire.casting as DiaryEntry['casting'],
      supervisorNotes: wire.supervisorNotes,
      receivedToday: wire.receivedToday ?? '',
      deliveryLedger: wire.deliveryLedger ?? existing?.deliveryLedger,
      supervisorSignature: wire.supervisorSignature,
      managerSignature: wire.managerSignature,
      photos: keepReadablePhotos(decoded.get(wire.uid) ?? [], existing?.photos),
      // A manager signature raises the status, and a signed page never falls
      // back to draft. Older peers can still send the pre-v5 combination of a
      // manager signature with `draft`, so trusting the wire value here would
      // undo the invariant that `saveEntry` and the v5 migration enforce.
      status:
        wire.managerSignature?.trim() || existing?.status === 'signed'
          ? 'signed'
          : wire.status,
      pinned: wire.pinned ?? false,
      syncConflict: wire.syncConflict,
      syncConflictKind: wire.syncConflictKind,
      syncConflictGroup: wire.syncConflictGroup,
      syncConflictRoot: wire.syncConflictRoot,
      syncRevision: wire.syncRevision,
      createdAt: wire.createdAt,
      updatedAt: wire.updatedAt,
    };
    // Set rather than always assigned: `deletedAt: undefined` on a record is
    // not the same as no `deletedAt` at all once it has been through IndexedDB.
    if (wire.deletedAt !== undefined) entry.deletedAt = wire.deletedAt;
    const remoteRevision = validatedEntryRevision(entry, wire.syncRevision);
    entry.syncRevision = remoteRevision;
    const entryStone = entryStones.get(wire.uid);
    if (entryStone?.entryRevision) {
      const deletionOrder = compareEntryRevisions(
        entryStone.entryRevision,
        remoteRevision,
      );
      if (deletionOrder === 'local-ahead' || deletionOrder === 'same') continue;
      if (deletionOrder === 'concurrent') {
        entry = {
          ...entry,
          syncConflict: true,
          syncConflictKind: 'deletion',
          syncConflictGroup: entry.syncConflictGroup ?? `deletion:${wire.uid}`,
          syncConflictRoot: entry.syncConflictRoot ?? wire.uid,
        };
      } else {
        // The incoming entry causally follows our tombstone. Its restore/Keep
        // decision makes that deletion obsolete on this device too.
        await db.tombstones.delete(wire.uid);
        entryStones.delete(wire.uid);
      }
    } else if (isDeleted('entries', wire.uid, wire.updatedAt)) {
      continue;
    }

    if (existing) {
      const localRevision = validatedEntryRevision(existing);
      const relation = compareEntryRevisions(localRevision, remoteRevision);
      if (relation === 'local-ahead') continue;
      if (relation === 'same') {
        const addsConflictMetadata =
          (!!entry.syncConflict && !existing.syncConflict) ||
          (!!entry.syncConflictKind && !existing.syncConflictKind) ||
          (!!entry.syncConflictGroup && !existing.syncConflictGroup) ||
          (!!entry.syncConflictRoot && !existing.syncConflictRoot);
        if (!addsConflictMetadata) continue;
        await db.entries.update(existing.id!, {
          syncConflict: existing.syncConflict || entry.syncConflict,
          syncConflictKind: existing.syncConflictKind ?? entry.syncConflictKind,
          syncConflictGroup: existing.syncConflictGroup ?? entry.syncConflictGroup,
          syncConflictRoot: existing.syncConflictRoot ?? entry.syncConflictRoot,
          updatedAt: Math.max(existing.updatedAt, entry.updatedAt),
        });
        result.entries += 1;
        continue;
      }
      if (relation === 'concurrent') {
        const mergedRevision = mergeEquivalentEntryRevisions(
          localRevision,
          remoteRevision,
        );
        if (mergedRevision) {
          const newer = entry.updatedAt > existing.updatedAt ? entry : existing;
          entry = {
            ...newer,
            id: existing.id,
            uid: existing.uid,
            projectId: project.id,
            photos: keepReadablePhotos(entry.photos, existing.photos),
            syncRevision: mergedRevision,
            syncConflict: existing.syncConflict || entry.syncConflict,
            syncConflictKind: existing.syncConflictKind ?? entry.syncConflictKind,
            syncConflictGroup: existing.syncConflictGroup ?? entry.syncConflictGroup,
            syncConflictRoot: existing.syncConflictRoot ?? entry.syncConflictRoot,
            updatedAt: Math.max(existing.updatedAt, entry.updatedAt),
          };
          await db.entries.put(entry);
          result.entries += 1;
          continue;
        }
        await preserveConcurrentBranches(
          existing,
          entry,
          localRevision,
          remoteRevision,
        );
        result.entries += 1;
        result.conflicts += 1;
        continue;
      }
      // `remote-ahead` falls through to the ordinary replacement below.
    }

    // Two devices can independently create their own page for the same
    // project/date while offline. Deleting the lower timestamp here silently
    // discarded a whole day. Keep both records and mark the pair so either can
    // still be edited until the user deliberately moves one to the trash.
    const clash = await db.entries
      .where({ projectId: project.id, date: wire.date })
      .filter((candidate) => candidate.uid !== wire.uid && candidate.deletedAt === undefined)
      .first();
    let conflictGroup = entry.syncConflictGroup ?? existing?.syncConflictGroup;
    if (clash?.id !== undefined) {
      conflictGroup ??=
        clash.syncConflictGroup ?? conflictGroupFor(clash.uid, wire.uid);
      await db.entries.update(clash.id, {
        syncConflict: true,
        syncConflictKind: 'revision',
        syncConflictGroup: conflictGroup,
      });
      entry = {
        ...entry,
        syncConflict: true,
        syncConflictKind: 'revision',
        syncConflictGroup: conflictGroup,
      };
      result.conflicts += 1;
    }
    await db.entries.put(entry);
    if (
      existing &&
      (existing.projectId !== entry.projectId || existing.date !== entry.date)
    ) {
      await clearResolvedConflict(existing, entry.updatedAt);
    }
    await clearResolvedConflict(entry, entry.updatedAt);
    result.entries += 1;
  }

  // --- ספקים וקבלנים: last write wins, like everything else
  for (const wire of payload.contacts ?? []) {
    if (isDeleted('contacts', wire.uid, wire.updatedAt)) continue;
    const existing = await db.contacts.where('uid').equals(wire.uid).first();
    if (existing && existing.updatedAt >= wire.updatedAt) continue;
    await db.contacts.put({
      id: existing?.id,
      uid: wire.uid,
      name: wire.name,
      trade: wire.trade,
      phone: wire.phone,
      projects: wire.projects,
      notes: wire.notes,
      createdAt: wire.createdAt,
      updatedAt: wire.updatedAt,
    });
    result.contacts += 1;
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
      result.presets += 1;
    } else if (wire.uses > existing.uses) {
      await db.presets.update(existing.id, {
        uses: wire.uses,
        updatedAt: Math.max(existing.updatedAt, wire.updatedAt),
      });
      result.presets += 1;
    }
  }

  // --- shared settings
  for (const wire of payload.settings) {
    const existing = await db.settings.get(wire.key);
    if (!existing || (existing.updatedAt ?? 0) < wire.updatedAt) {
      await db.settings.put({ key: wire.key, value: wire.value, updatedAt: wire.updatedAt });
      result.settings += 1;
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

/** Clears a conflict marker after a received move/delete leaves one live alternative. */
async function clearResolvedConflict(
  entry: Pick<DiaryEntry, 'projectId' | 'date' | 'syncConflictGroup'>,
  after: number,
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
    updatedAt: Math.max(Date.now(), live[0].updatedAt, after) + 1,
  });
}

/** Old tombstones would otherwise grow without bound. */
async function pruneTombstones(): Promise<void> {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  await db.tombstones.filter((t) => t.deletedAt < cutoff).delete();
}
