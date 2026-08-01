/**
 * Performs a sync against another device on the same network.
 *
 * One round trip: we send our manifest, the other side replies with what it
 * wants and with the records we were missing. A second, short call delivers
 * what it asked for. Photos only move when one side genuinely lacks them.
 */
import { db } from '../db';
import { whatToRequest, type SyncExchange, type SyncResponse } from './protocol';
import { applyPayload, buildManifest, collectPayload, type ApplyResult } from './store';

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

async function post(peer: Peer, body: SyncExchange): Promise<SyncResponse> {
  const response = await fetch(`${baseUrl(peer.address)}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Yoman-Code': peer.code },
    body: JSON.stringify(body),
  });

  if (response.status === 401) throw new Error('BAD_CODE');
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return (await response.json()) as SyncResponse;
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

export async function syncNow(peer: Peer): Promise<SyncOutcome> {
  const manifest = await buildManifest(deviceName());

  // First call: our manifest, and nothing else. We cannot know what the other
  // side needs until it has seen it.
  const first = await post(peer, {
    manifest,
    payload: { projects: [], entries: [], presets: [], settings: [], tombstones: [] },
  });

  // Apply whatever it already decided to send us.
  const received = await applyPayload(first.payload);

  // Second call: exactly what it asked for.
  let sent = { projects: 0, entries: 0 };
  const wanted = first.wanted;
  if (wanted.projects.length || wanted.entries.length || wanted.settings.length) {
    const payload = await collectPayload(wanted);
    sent = { projects: payload.projects.length, entries: payload.entries.length };
    const second = await post(peer, { manifest: await buildManifest(deviceName()), payload });
    // The other side may have had more for us once it saw the fresh manifest.
    const extra = await applyPayload(second.payload);
    received.projects += extra.projects;
    received.entries += extra.entries;
    received.deleted += extra.deleted;
  }

  localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  return { received, sent, peerName: first.deviceName };
}

/**
 * The other half: answering a sync request that arrived from the network.
 * Only the Mac app runs this, but the logic is identical on both sides.
 */
export async function answerExchange(exchange: SyncExchange): Promise<SyncResponse> {
  // Whatever they sent us goes in first, so our reply reflects it.
  if (exchange.payload) await applyPayload(exchange.payload);

  const ours = await buildManifest(deviceName());
  const wanted = whatToRequest(exchange.manifest, ours);
  const forThem = whatToRequest(ours, exchange.manifest);

  return {
    version: ours.version,
    deviceName: ours.deviceName,
    wanted: forThem,
    payload: await collectPayload(wanted),
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
