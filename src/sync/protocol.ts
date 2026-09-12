/**
 * The shape of a sync conversation between two devices.
 *
 * Both sides hold a full copy of the diary, so syncing is a merge rather than a
 * client/server relationship. The exchange is deliberately in two steps:
 *
 *   1. each side sends a *manifest* — one line per record, uid and updatedAt
 *   2. each side then asks only for the records the other has newer
 *
 * Photos are the reason. A diary page carries megabytes of them; sending whole
 * records just to discover they are identical would make syncing over Wi-Fi
 * painful. A manifest for a year of entries is a few kilobytes.
 *
 * Conflicts are resolved by `updatedAt`, last write wins. That is correct for
 * one person with two devices, which is what this is for.
 */
import type { DeliveryLedger, TombstoneTable } from '../types';
import { compareEntryRevisions } from './revision';

export type { TombstoneTable };

/**
 * 5 — entry manifests carry causal revisions, so equal timestamps, clock skew
 * and concurrent same-UID edits cannot silently choose one branch. Version 4
 * retained independent same-date UIDs; version 3 planned metadata separately;
 * version 2 introduced chunking. Mixed versions are refused before mutation.
 */
export const SYNC_PROTOCOL_VERSION = 5;

/** One line of a manifest: what a record is, and how fresh. */
export interface RecordStamp {
  uid: string;
  updatedAt: number;
}

export interface EntryStamp extends RecordStamp {
  syncRevision: string;
}

export interface SyncManifest {
  version: number;
  deviceName: string;
  projects: RecordStamp[];
  entries: EntryStamp[];
  /**
   * ספקים וקבלנים. Optional, and `SYNC_PROTOCOL_VERSION` deliberately does not
   * move for it: a peer on an older build simply omits the field, and the only
   * consequence is that its address book waits for the update. Bumping the
   * version would have stopped the two devices syncing *anything* — the diary
   * pages included — until both were updated, which is a bad trade for a list
   * of phone numbers. Same bargain as `receivedToday` and `pinned`.
   */
  contacts?: RecordStamp[];
  /** Keyed `kind value`; merged by taking the higher use count. */
  presets: { key: string; uses: number; updatedAt: number }[];
  tombstones: {
    uid: string;
    table: TombstoneTable;
    deletedAt: number;
    entryRevision?: string;
  }[];
  /** Synced settings, e.g. the company logo. */
  settings: { key: string; updatedAt: number }[];
}

/** A project as it travels — the numeric id is local and deliberately absent. */
export interface WireProject {
  uid: string;
  name: string;
  address: string;
  company: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

/** An entry as it travels: photos become data URLs, as in the backup file. */
export interface WireEntry {
  uid: string;
  projectUid: string;
  date: string;
  weather: string;
  management: unknown[];
  contractors: unknown[];
  equipment: unknown[];
  workDescription: string;
  casting: unknown;
  supervisorNotes: string;
  /** התקבל היום — optional for the same reason `pinned` is. */
  receivedToday?: string;
  /** Optional addition: absence is an older build, an empty ledger is explicit clearing. */
  deliveryLedger?: DeliveryLedger;
  supervisorSignature: string;
  managerSignature: string;
  photos: { id: string; caption: string; dataUrl: string; width: number; height: number; takenAt: number }[];
  status: 'draft' | 'signed';
  /**
   * Optional on purpose, so the protocol version does not have to move: a peer
   * running an older build simply omits the field and its pages arrive
   * unpinned, which is the right answer rather than an error.
   */
  pinned?: boolean;
  /**
   * In the other device's trash too. Optional for the same reason as `pinned`:
   * a peer on an older build omits it, and its pages arrive not-in-the-trash,
   * which is the right answer rather than an error.
   */
  deletedAt?: number;
  /** Both independently-created pages for one date are retained. */
  syncConflict?: boolean;
  /** Deletion conflicts may have one live row plus a causal tombstone. */
  syncConflictKind?: 'revision' | 'deletion';
  /** Links preserved alternatives even when one revision changed the date. */
  syncConflictGroup?: string;
  /** Original UID shared by every causally-conflicting branch. */
  syncConflictRoot?: string;
  /** Required since protocol v5; content fingerprint + version vector. */
  syncRevision: string;
  createdAt: number;
  updatedAt: number;
}

/** One line of ספקים וקבלנים as it travels. Small enough to never need chunking. */
export interface WireContact {
  uid: string;
  name: string;
  trade: string;
  phone: string;
  projects: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface WirePreset {
  kind: string;
  value: string;
  uses: number;
  updatedAt: number;
}

export interface WireSetting {
  key: string;
  value: unknown;
  updatedAt: number;
}

/** What one side wants from the other, worked out from the two manifests. */
export interface SyncRequest {
  projects: string[];
  entries: string[];
  settings: string[];
  /** Absent when the peer is an older build with no address book to offer. */
  contacts?: string[];
  /** The peer has a preset count we have not merged yet. */
  presets?: boolean;
  /** The peer has a deletion we have not merged yet. */
  tombstones?: boolean;
}

export interface SyncPayload {
  projects: WireProject[];
  entries: WireEntry[];
  contacts?: WireContact[];
  presets: WirePreset[];
  settings: WireSetting[];
  tombstones: {
    uid: string;
    table: TombstoneTable;
    deletedAt: number;
    entryRevision?: string;
  }[];
}

/**
 * One round of the conversation.
 *
 * A sync is now several of these rather than one: the client opens with its
 * manifest, then pulls what it lacks a chunk at a time, then pushes what the
 * other side lacks a chunk at a time. Every round carries a bounded amount of
 * data, which is what keeps a diary full of photos from having to be held in
 * memory three times over — once to build, once to send, once to forward.
 */
export interface SyncExchange {
  manifest: SyncManifest;
  /** Records the client is delivering in this round. */
  payload: SyncPayload;
  /** Records the client wants back in this round. Absent on the opening call. */
  pull?: SyncRequest;
}

export interface SyncResponse {
  version: number;
  deviceName: string;
  /**
   * The responder's own manifest, so the caller can work out what to pull.
   * Only worth sending on the opening round.
   */
  manifest?: SyncManifest;
  /** What the responder wants, worked out from the caller's manifest. */
  wanted: SyncRequest;
  /** Exactly the records named in `pull`. */
  payload: SyncPayload;
}

const stampMap = (stamps: RecordStamp[]): Map<string, number> =>
  new Map(stamps.map((s) => [s.uid, s.updatedAt]));

/**
 * Which of `theirs` we should ask for: anything we lack, or that they hold a
 * newer copy of. Tombstones on our side suppress the request — a record we
 * deleted should not be pulled back before our deletion has been applied.
 */
export function whatToRequest(
  ours: SyncManifest,
  theirs: SyncManifest,
): SyncRequest {
  const deleted = new Map<string, number>();
  const entryDeletions = new Map<string, SyncManifest['tombstones'][number]>();
  for (const tombstone of ours.tombstones) {
    const key = `${tombstone.table}:${tombstone.uid}`;
    deleted.set(key, Math.max(deleted.get(key) ?? 0, tombstone.deletedAt));
    if (tombstone.table === 'entries') {
      const held = entryDeletions.get(tombstone.uid);
      if (!held || held.deletedAt < tombstone.deletedAt) {
        entryDeletions.set(tombstone.uid, tombstone);
      }
    }
  }

  const pick = (
    mine: RecordStamp[],
    other: RecordStamp[],
    table: TombstoneTable,
  ): string[] => {
    const local = stampMap(mine);
    return other
      .filter((stamp) => {
        // A deletion suppresses the copy it deleted, but not a record edited or
        // restored afterwards. `applyPayload` uses the same >= comparison.
        if ((deleted.get(`${table}:${stamp.uid}`) ?? -1) >= stamp.updatedAt) return false;
        const have = local.get(stamp.uid);
        return have === undefined || stamp.updatedAt > have;
      })
      .map((stamp) => stamp.uid);
  };

  const localSettings = new Map(ours.settings.map((s) => [s.key, s.updatedAt]));
  const localEntries = new Map(ours.entries.map((entry) => [entry.uid, entry]));
  const localPresets = new Map(ours.presets.map((preset) => [preset.key, preset.uses]));
  const localTombstones = new Map<string, number>();
  for (const tombstone of ours.tombstones) {
    const key = `${tombstone.table}:${tombstone.uid}`;
    localTombstones.set(
      key,
      Math.max(localTombstones.get(key) ?? 0, tombstone.deletedAt),
    );
  }

  return {
    projects: pick(ours.projects, theirs.projects, 'projects'),
    entries: theirs.entries
      .filter((stamp) => {
        const stone = entryDeletions.get(stamp.uid);
        if (stone?.entryRevision) {
          const deletionOrder = compareEntryRevisions(
            stone.entryRevision,
            stamp.syncRevision,
          );
          if (deletionOrder === 'same' || deletionOrder === 'local-ahead') return false;
        } else if ((stone?.deletedAt ?? -1) >= stamp.updatedAt) {
          return false;
        }
        const mine = localEntries.get(stamp.uid);
        if (!mine) return true;
        const order = compareEntryRevisions(mine.syncRevision, stamp.syncRevision);
        // Concurrent vectors must travel in both directions. `applyPayload`
        // deterministically keeps both branches; timestamps never break this tie.
        return order === 'remote-ahead' || order === 'concurrent';
      })
      .map((stamp) => stamp.uid),
    // `?? []` on both sides: a peer that predates the address book sends no
    // list, which asks for nothing rather than throwing mid-sync.
    contacts: pick(ours.contacts ?? [], theirs.contacts ?? [], 'contacts'),
    settings: theirs.settings
      .filter((s) => (localSettings.get(s.key) ?? -1) < s.updatedAt)
      .map((s) => s.key),
    // Presets and tombstones are sent with the small metadata payload. They
    // still need to make a round happen when they are the only changed data;
    // otherwise a deletion can report a successful sync without ever leaving
    // the device that made it.
    presets: theirs.presets.some(
      (preset) => (localPresets.get(preset.key) ?? -1) < preset.uses,
    ),
    tombstones: theirs.tombstones.some(
      (tombstone) => {
        const localDeletedAt =
          localTombstones.get(`${tombstone.table}:${tombstone.uid}`) ?? -1;
        if (tombstone.table !== 'entries' || !tombstone.entryRevision) {
          return localDeletedAt < tombstone.deletedAt;
        }
        const local = entryDeletions.get(tombstone.uid);
        if (!local?.entryRevision) {
          const localEntry = localEntries.get(tombstone.uid);
          if (!localEntry) return true;
          const entryOrder = compareEntryRevisions(
            localEntry.syncRevision,
            tombstone.entryRevision,
          );
          return entryOrder === 'remote-ahead' || entryOrder === 'concurrent';
        }
        const order = compareEntryRevisions(
          local.entryRevision,
          tombstone.entryRevision,
        );
        return order === 'remote-ahead' || order === 'concurrent';
      },
    ),
  };
}

/** Settings that are shared between devices; everything else stays local. */
export const SYNCED_SETTINGS = [
  'companyLogo',
  'documentTheme',
  // A signature belongs to the person, not the device, so it should be there
  // whichever one is in hand on site.
  'signature.manager',
  'signature.supervisor',
] as const;
