import type { DiaryEntry, Photo } from '../types';
import { uid } from '../lib/id';

/** Device-local identity used as one component of every entry version vector. */
export const ENTRY_REVISION_DEVICE_KEY = 'yoman-entry-revision-device';

interface ParsedEntryRevision {
  content: string;
  clock: Map<string, number>;
  verified: boolean;
}

export type RevisionOrder = 'same' | 'local-ahead' | 'remote-ahead' | 'concurrent';

let memoryDeviceId: string | null = null;

/** Stable for this installation, deliberately absent from backup and sync. */
export function entryRevisionDeviceId(): string {
  if (memoryDeviceId) return memoryDeviceId;
  try {
    const held = localStorage.getItem(ENTRY_REVISION_DEVICE_KEY);
    if (held) return (memoryDeviceId = held);
    const made =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : uid();
    localStorage.setItem(ENTRY_REVISION_DEVICE_KEY, made);
    return (memoryDeviceId = made);
  } catch {
    return (memoryDeviceId ??= uid());
  }
}

const MASK_64 = (1n << 64n) - 1n;
const FNV_PRIME = 0x100000001b3n;
const FNV_OFFSET = 0xcbf29ce484222325n;
const ALT_OFFSET = 0x84222325cbf29ce4n;

/** Compact deterministic 128-bit identifier; input is never exposed or logged. */
export function stableHash(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let forward = FNV_OFFSET;
  let reverse = ALT_OFFSET;
  for (let index = 0; index < bytes.length; index += 1) {
    forward = ((forward ^ BigInt(bytes[index])) * FNV_PRIME) & MASK_64;
    reverse =
      ((reverse ^ BigInt(bytes[bytes.length - index - 1])) * FNV_PRIME) & MASK_64;
  }
  return `${forward.toString(16).padStart(16, '0')}${reverse
    .toString(16)
    .padStart(16, '0')}`;
}

const byteHashCache = new WeakMap<Uint8Array, string>();

function byteHash(bytes: Uint8Array): string {
  const cached = byteHashCache.get(bytes);
  if (cached) return cached;
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  let c = 0x85ebca6b;
  let d = 0xc2b2ae35;
  for (const value of bytes) {
    a = Math.imul(a ^ value, 0x01000193);
    b = Math.imul(b ^ value, 0x27d4eb2d);
    c = Math.imul(c ^ value, 0x165667b1);
    d = Math.imul(d ^ value, 0x9e3779b1);
  }
  const hash = [a, b, c, d]
    .map((part) => (part >>> 0).toString(16).padStart(8, '0'))
    .join('');
  byteHashCache.set(bytes, hash);
  return hash;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function photoIdentity(photo: Photo): { value: unknown; verified: boolean } {
  const byteLength = photo.bytes?.byteLength ?? photo.blob?.size ?? 0;
  const hasBytes = (photo.bytes?.byteLength ?? 0) > 0;
  return {
    verified: hasBytes,
    value: {
      id: photo.id,
      caption: photo.caption,
      width: photo.width,
      height: photo.height,
      takenAt: photo.takenAt,
      byteLength,
      // A Blob body cannot be read synchronously during an IndexedDB schema
      // upgrade. Mark that legacy head unverified so peers conservatively
      // exchange/preserve it; every ordinary save first converts it to bytes.
      bytes: hasBytes ? byteHash(photo.bytes!) : null,
    },
  };
}

function entryContent(entry: DiaryEntry): { fingerprint: string; verified: boolean } {
  const photos = entry.photos.map(photoIdentity);
  return {
    verified: photos.every((photo) => photo.verified),
    fingerprint: stableHash(
      stableJson({
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
        deliveryLedger: entry.deliveryLedger ?? null,
        supervisorSignature: entry.supervisorSignature,
        managerSignature: entry.managerSignature,
        photos: photos.map((photo) => photo.value),
        status: entry.status,
        pinned: entry.pinned ?? false,
        deletedAt: entry.deletedAt ?? null,
        createdAt: entry.createdAt,
      }),
    ),
  };
}

/** Fingerprint of fields that make this one logical diary revision. */
export function entryContentFingerprint(entry: DiaryEntry): string {
  return entryContent(entry).fingerprint;
}

function encodeRevision(revision: ParsedEntryRevision): string {
  return JSON.stringify([
    1,
    revision.content,
    [...revision.clock.entries()].sort(([a], [b]) => a.localeCompare(b)),
    revision.verified,
  ]);
}

function parseRevision(raw: string | undefined): ParsedEntryRevision | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed[0] !== 1 || typeof parsed[1] !== 'string') {
      return null;
    }
    if (!Array.isArray(parsed[2])) return null;
    const clock = new Map<string, number>();
    for (const pair of parsed[2]) {
      if (
        !Array.isArray(pair) ||
        typeof pair[0] !== 'string' ||
        !Number.isSafeInteger(pair[1]) ||
        pair[1] < 1
      ) {
        return null;
      }
      clock.set(pair[0], Math.max(clock.get(pair[0]) ?? 0, pair[1]));
    }
    if (clock.size === 0) return null;
    return { content: parsed[1], clock, verified: parsed[3] === true };
  } catch {
    return null;
  }
}

/** Deterministic base for a row created before causal revision metadata. */
export function legacyEntryRevision(entry: DiaryEntry): string {
  const content = entryContent(entry);
  const legacyHead = content.verified
    ? `legacy:${content.fingerprint}`
    : `legacy-unverified:${entryRevisionDeviceId()}:${content.fingerprint}`;
  return encodeRevision({
    content: content.fingerprint,
    clock: new Map([[legacyHead, 1]]),
    verified: content.verified,
  });
}

export function ensuredEntryRevision(entry: DiaryEntry): string {
  return parseRevision(entry.syncRevision) ? entry.syncRevision! : legacyEntryRevision(entry);
}

/** Rejects stale/corrupt metadata by deriving a conservative legacy head. */
export function validatedEntryRevision(entry: DiaryEntry, raw = entry.syncRevision): string {
  const parsed = parseRevision(raw);
  const content = entryContent(entry);
  return parsed?.content === content.fingerprint && parsed.verified === content.verified
    ? raw!
    : legacyEntryRevision(entry);
}

/** Advances one causal branch for a local save or restore. */
export function advanceEntryRevision(
  entry: DiaryEntry,
  baseRevision: string | undefined = entry.syncRevision,
  deviceId = entryRevisionDeviceId(),
  knownRevisions: (string | undefined)[] = [],
): string {
  const base = parseRevision(baseRevision) ?? parseRevision(legacyEntryRevision(entry))!;
  const clock = new Map(base.clock);
  for (const raw of knownRevisions) {
    const known = parseRevision(raw);
    if (!known) continue;
    for (const [knownDevice, count] of known.clock) {
      clock.set(knownDevice, Math.max(clock.get(knownDevice) ?? 0, count));
    }
  }
  clock.set(deviceId, (clock.get(deviceId) ?? 0) + 1);
  const content = entryContent(entry);
  return encodeRevision({
    content: content.fingerprint,
    clock,
    verified: content.verified,
  });
}

/**
 * Re-fingerprints the same causal head after a Blob wrapper becomes bytes.
 * The photograph did not change, so the vector does not advance; both devices
 * that recover the same bytes derive the same verified head.
 */
export function refreshEntryRevisionContent(
  entry: DiaryEntry,
  baseRevision: string | undefined = entry.syncRevision,
): string {
  const base = parseRevision(baseRevision) ?? parseRevision(legacyEntryRevision(entry))!;
  const content = entryContent(entry);
  return encodeRevision({
    content: content.fingerprint,
    clock: new Map(base.clock),
    verified: content.verified,
  });
}

/** Causal relationship between the local and remote revisions. */
export function compareEntryRevisions(
  localRaw: string | undefined,
  remoteRaw: string | undefined,
): RevisionOrder {
  const local = parseRevision(localRaw);
  const remote = parseRevision(remoteRaw);
  // Protocol v5 normally makes both present. Malformed metadata is treated as
  // concurrent so a payload is requested and no branch is silently discarded.
  if (!local || !remote) return 'concurrent';
  if (localRaw === remoteRaw) return local.verified ? 'same' : 'concurrent';

  const devices = new Set([...local.clock.keys(), ...remote.clock.keys()]);
  let localGreater = false;
  let remoteGreater = false;
  for (const device of devices) {
    const mine = local.clock.get(device) ?? 0;
    const theirs = remote.clock.get(device) ?? 0;
    if (mine > theirs) localGreater = true;
    if (theirs > mine) remoteGreater = true;
  }
  if (localGreater && !remoteGreater) return 'local-ahead';
  if (remoteGreater && !localGreater) return 'remote-ahead';
  if (
    !localGreater &&
    !remoteGreater &&
    local.content === remote.content &&
    local.verified &&
    remote.verified
  ) {
    return 'same';
  }
  return 'concurrent';
}

export function entryRevisionContent(raw: string | undefined): string | null {
  return parseRevision(raw)?.content ?? null;
}

/** Joins causally-concurrent clocks after both produced identical content. */
export function mergeEquivalentEntryRevisions(
  localRaw: string,
  remoteRaw: string,
): string | null {
  const local = parseRevision(localRaw);
  const remote = parseRevision(remoteRaw);
  if (
    !local ||
    !remote ||
    !local.verified ||
    !remote.verified ||
    local.content !== remote.content
  ) {
    return null;
  }
  const clock = new Map(local.clock);
  for (const [device, count] of remote.clock) {
    clock.set(device, Math.max(clock.get(device) ?? 0, count));
  }
  return encodeRevision({ content: local.content, clock, verified: true });
}

/** Joins two concurrent permanent-deletion intents into one dominating head. */
export function mergeEntryDeletionRevisions(
  localRaw: string,
  remoteRaw: string,
): string | null {
  const local = parseRevision(localRaw);
  const remote = parseRevision(remoteRaw);
  if (!local || !remote) return null;
  const clock = new Map(local.clock);
  for (const [device, count] of remote.clock) {
    clock.set(device, Math.max(clock.get(device) ?? 0, count));
  }
  const orderedClock = [...clock.entries()].sort(([a], [b]) => a.localeCompare(b));
  return encodeRevision({
    content: stableHash(`deletion\u0000${JSON.stringify(orderedClock)}`),
    clock,
    verified: true,
  });
}

/** Both peers derive the same persistent identity for one preserved branch. */
export function stableConflictBranchUid(rootUid: string, revision: string): string {
  return `conflict-${stableHash(`${rootUid}\u0000${revision}`)}`;
}

/** Deterministic ordering decides which branch retains the original UID. */
export function revisionWinner(localRevision: string, remoteRevision: string): 'local' | 'remote' {
  return localRevision.localeCompare(remoteRevision) >= 0 ? 'local' : 'remote';
}
