/**
 * Performs a sync against another device on the same network.
 *
 * One round trip: we send our manifest, the other side replies with what it
 * wants and with the records we were missing. A second, short call delivers
 * what it asked for. Photos only move when one side genuinely lacks them.
 */
import { db } from '../db';
import {
  SYNC_PROTOCOL_VERSION,
  whatToRequest,
  type SyncExchange,
  type SyncManifest,
  type SyncPayload,
  type SyncResponse,
} from './protocol';
import {
  applyPayload,
  buildManifest,
  collectEntryChunk,
  collectMeta,
  type ApplyResult,
} from './store';
import { logger } from '../lib/log';

/**
 * Entries requested per round when pulling.
 *
 * The push side sizes its own chunks by weight, because it can see the photos
 * before sending them. The pull side only has uids, so it goes by count and
 * keeps the number low — the responder still bounds each reply by weight.
 */
const PULL_CHUNK = 8;

/** Reported while a sync runs, so a long transfer does not look like a freeze. */
export interface SyncProgress {
  phase: 'pull' | 'push';
  done: number;
  total: number;
}

const log = logger('sync');

const PAIR_KEY = 'yoman-sync-peer';
const LAST_SYNC_KEY = 'yoman-sync-last';

export interface Peer {
  address: string;
  code: string;
}

export function readPeer(): Peer | null {
  try {
    const raw = localStorage.getItem(PAIR_KEY);
    return raw ? (JSON.parse(raw) as Peer) : null;
  } catch {
    return null;
  }
}

export function savePeer(peer: Peer): void {
  localStorage.setItem(PAIR_KEY, JSON.stringify(peer));
}

export function forgetPeer(): void {
  localStorage.removeItem(PAIR_KEY);
  localStorage.removeItem(LAST_SYNC_KEY);
}

export function lastSyncAt(): number | null {
  const raw = localStorage.getItem(LAST_SYNC_KEY);
  return raw ? Number(raw) : null;
}

/** `192.168.1.20:45231` or a full URL — both are accepted from the user. */
function baseUrl(address: string): string {
  const trimmed = address.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function deviceName(): string {
  if (typeof navigator === 'undefined') return 'device';
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return 'iPhone';
  if (navigator.userAgent.includes('Mac')) return 'Mac';
  return 'device';
}

/**
 * How long one round may take before it is abandoned.
 *
 * `fetch` has no timeout of its own: without this, a Mac that went to sleep
 * mid-sync left the phone with a spinner for as long as the platform felt like
 * waiting, which is exactly what "it takes ages and then fails" looked like.
 * Generous, because a chunk full of photos over Wi-Fi is genuinely slow.
 */
const ROUND_TIMEOUT_MS = 45_000;

async function post(peer: Peer, body: SyncExchange): Promise<SyncResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROUND_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl(peer.address)}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Yoman-Code': peer.code },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    // An abort and a refused connection both land here, and they mean very
    // different things to someone standing on a site with a phone.
    if ((error as DOMException)?.name === 'AbortError') throw new Error('TIMEOUT');
    throw new Error('UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) throw new Error('BAD_CODE');
  if (!response.ok) throw new Error(`HTTP_${response.status}`);

  const answer = (await response.json()) as SyncResponse;
  if (answer.version !== SYNC_PROTOCOL_VERSION) throw new Error('VERSION_MISMATCH');
  return answer;
}

export interface SyncOutcome {
  received: ApplyResult;
  sent: { projects: number; entries: number };
  peerName: string;
}

/** Checks an address before pairing, so a typo is caught immediately. */
export async function probe(address: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl(address)}/sync/hello`, { method: 'GET' });
    if (!response.ok) return false;
    const body = (await response.json()) as { app?: string };
    return body.app === 'yoman-avoda';
  } catch {
    return false;
  }
}

export async function syncNow(
  peer: Peer,
  onProgress?: (step: SyncProgress) => void,
): Promise<SyncOutcome> {
  // Sync is the hardest thing here to debug after the fact: it involves two
  // devices, a network, and a merge, and the user only ever sees the result.
  // Record counts at each step — never the records themselves.
  const done = log.time('sync');
  const manifest = await buildManifest(deviceName());
  log.info('sync started', {
    projects: manifest.projects.length,
    entries: manifest.entries.length,
    tombstones: manifest.tombstones.length,
  });

  try {
    return await runSync(peer, manifest, done, onProgress);
  } catch (error) {
    done('failed');
    // BAD_CODE and HTTP_* are thrown by `post` above and are the two the user
    // can actually act on, so they are named rather than buried in a stack.
    log.error('sync failed', error);
    throw error;
  }
}

const EMPTY_PAYLOAD: SyncPayload = {
  projects: [],
  entries: [],
  presets: [],
  settings: [],
  tombstones: [],
};

async function runSync(
  peer: Peer,
  manifest: SyncManifest,
  done: (note?: string) => void,
  onProgress?: (step: SyncProgress) => void,
): Promise<SyncOutcome> {
  // Round 1 — manifests only. Both sides now know exactly what the other is
  // missing, and nothing heavy has moved yet.
  const hello = await post(peer, { manifest, payload: EMPTY_PAYLOAD });
  const theirs = hello.manifest;
  if (!theirs) throw new Error('VERSION_MISMATCH');

  const toPull = whatToRequest(manifest, theirs);
  const wanted = hello.wanted;
  const totalIn = toPull.entries.length;
  const totalOut = wanted.entries.length;
  log.info('sync plan', {
    peer: hello.deviceName,
    pullProjects: toPull.projects.length,
    pullEntries: totalIn,
    pushProjects: wanted.projects.length,
    pushEntries: totalOut,
  });

  const received: ApplyResult = { projects: 0, entries: 0, deleted: 0 };
  const add = (part: ApplyResult) => {
    received.projects += part.projects;
    received.entries += part.entries;
    received.deleted += part.deleted;
  };

  // Round 2 — pull. Projects, presets, tombstones and settings are small and
  // come in one go; entries follow a chunk at a time because of their photos.
  if (toPull.projects.length || toPull.settings.length || totalIn) {
    const meta = await post(peer, {
      manifest,
      payload: EMPTY_PAYLOAD,
      pull: { ...toPull, entries: [] },
    });
    add(await applyPayload(meta.payload));

    let from = 0;
    while (from < totalIn) {
      const slice = toPull.entries.slice(from, from + PULL_CHUNK);
      onProgress?.({ phase: 'pull', done: from, total: totalIn });
      const round = await post(peer, {
        manifest,
        payload: EMPTY_PAYLOAD,
        pull: { projects: [], settings: [], entries: slice },
      });
      const got = round.payload.entries.length;
      add(await applyPayload(round.payload));

      // The responder bounds its reply by weight and answers in the order it
      // was asked, so a short reply is a prefix, not a refusal — advance by
      // what actually arrived. Nothing at all means those pages are gone from
      // the other device, so the whole slice is skipped rather than retried
      // forever.
      from += got > 0 ? got : slice.length;
      log.debug('pulled chunk', { asked: slice.length, got });
    }
  }

  // Round 3 — push, the same way round.
  const sent = { projects: 0, entries: 0 };
  if (wanted.projects.length || wanted.settings.length || totalOut) {
    const meta = await collectMeta(wanted);
    sent.projects = meta.projects.length;
    await post(peer, { manifest, payload: meta });

    let index = 0;
    while (index < totalOut) {
      onProgress?.({ phase: 'push', done: index, total: totalOut });
      const chunk = await collectEntryChunk(wanted.entries, index);
      index = chunk.next;
      if (chunk.entries.length === 0) continue;
      await post(peer, {
        manifest,
        payload: { ...EMPTY_PAYLOAD, entries: chunk.entries },
      });
      sent.entries += chunk.entries.length;
      log.debug('pushed chunk', { entries: chunk.entries.length, bytes: chunk.bytes });
    }
  }

  localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  done();
  log.info('sync done', {
    peer: hello.deviceName,
    receivedProjects: received.projects,
    receivedEntries: received.entries,
    deleted: received.deleted,
    sentProjects: sent.projects,
    sentEntries: sent.entries,
  });
  return { received, sent, peerName: hello.deviceName };
}

/**
 * The other half: answering a sync request that arrived from the network.
 * Only the Mac app runs this, but the logic is identical on both sides.
 */
export async function answerExchange(exchange: SyncExchange): Promise<SyncResponse> {
  // Whatever they delivered goes in first, so our reply reflects it.
  if (exchange.payload) await applyPayload(exchange.payload);

  const ours = await buildManifest(deviceName());

  let payload: SyncPayload = EMPTY_PAYLOAD;
  if (exchange.pull) {
    // Bounded here too, by weight rather than by count: the caller cannot know
    // how heavy the pages it asked for are, and a reply is as capable of being
    // too big to hold as a request is.
    const meta = await collectMeta(exchange.pull);
    const chunk = await collectEntryChunk(exchange.pull.entries, 0);
    payload = { ...meta, entries: chunk.entries };
  }

  return {
    version: SYNC_PROTOCOL_VERSION,
    deviceName: ours.deviceName,
    // Only on the opening round. It is a few kilobytes, but repeating it on
    // every chunk of a long transfer is pure waste.
    manifest: exchange.pull ? undefined : ours,
    wanted: whatToRequest(ours, exchange.manifest),
    payload,
  };
}

/** True when this device can act as the hub other devices connect to. */
export const canHost = (): boolean => typeof window !== 'undefined' && !!window.yoman?.sync;

/** Registers the answering side once, on the Mac app. */
export function hostSync(): void {
  if (!canHost()) return;
  window.yoman!.sync!.onRequest(async (exchange) => answerExchange(exchange as SyncExchange));
}

/** Clears everything a sync could have brought in — used by tests and resets. */
export async function localCounts(): Promise<{ projects: number; entries: number }> {
  return { projects: await db.projects.count(), entries: await db.entries.count() };
}
