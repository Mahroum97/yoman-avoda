/** Focused sync-protocol regressions. No diary database is opened. */
import assert from 'node:assert/strict';
import {
  SYNC_PROTOCOL_VERSION,
  whatToRequest,
  type SyncManifest,
  type SyncPayload,
} from '../src/sync/protocol';

const manifest = (changes: Partial<SyncManifest> = {}): SyncManifest => ({
  version: SYNC_PROTOCOL_VERSION,
  deviceName: 'test',
  projects: [],
  entries: [],
  contacts: [],
  presets: [],
  tombstones: [],
  settings: [],
  ...changes,
});

// A permanent deletion used to produce no pull or push round at all.
const deletionOnly = whatToRequest(
  manifest(),
  manifest({ tombstones: [{ uid: 'entry-1', table: 'entries', deletedAt: 20 }] }),
);
assert.equal(deletionOnly.tombstones, true);

// A deletion suppresses its stale record, while a later edit or restore wins.
const withDeletion = manifest({
  tombstones: [{ uid: 'entry-1', table: 'entries', deletedAt: 20 }],
});
assert.deepEqual(
  whatToRequest(withDeletion, manifest({
    entries: [{ uid: 'entry-1', updatedAt: 10, syncRevision: 'legacy-a' }],
  })).entries,
  [],
);
assert.deepEqual(
  whatToRequest(withDeletion, manifest({
    entries: [{ uid: 'entry-1', updatedAt: 30, syncRevision: 'legacy-b' }],
  })).entries,
  ['entry-1'],
);

// Presets share the metadata path and must also make a round happen on their own.
assert.equal(
  whatToRequest(
    manifest(),
    manifest({ presets: [{ key: 'trade carpenter', uses: 2, updatedAt: 10 }] }),
  ).presets,
  true,
);

// A real project modification stamp makes edited project details requestable.
assert.deepEqual(
  whatToRequest(
    manifest({ projects: [{ uid: 'project-1', updatedAt: 10 }] }),
    manifest({ projects: [{ uid: 'project-1', updatedAt: 11 }] }),
  ).projects,
  ['project-1'],
);

// The responder must reject an old wire format before touching its payload.
// This test runs without IndexedDB; applying the synthetic project would throw.
const storage = new Map<string, string>();
// Keep the mismatch warning below the logger's Node-irrelevant Vite branch.
storage.set('logLevel', 'error');
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});
const { answerExchange } = await import('../src/sync/client');
const { countPayload } = await import('../src/sync/store');
const payload: SyncPayload = {
  projects: [{
    uid: 'must-not-be-applied',
    name: 'test',
    address: '',
    company: '',
    archived: false,
    createdAt: 1,
    updatedAt: 1,
  }],
  entries: [],
  contacts: [{
    uid: 'contact-1', name: '', trade: '', phone: '', projects: '', notes: '',
    createdAt: 1, updatedAt: 2,
  }],
  presets: [{ kind: 'trade', value: 'test', uses: 1, updatedAt: 3 }],
  settings: [{ key: 'documentTheme', value: 'navy', updatedAt: 4 }],
  tombstones: [{ uid: 'entry-gone', table: 'entries', deletedAt: 5 }],
};
assert.deepEqual(countPayload(payload), {
  projects: 1,
  entries: 0,
  contacts: 1,
  presets: 1,
  settings: 1,
  tombstones: 1,
});
const refused = await answerExchange({
  manifest: manifest({ version: SYNC_PROTOCOL_VERSION - 1 }),
  payload,
});
assert.equal(refused.version, SYNC_PROTOCOL_VERSION);
assert.deepEqual(refused.wanted.projects, []);
assert.deepEqual(refused.payload.projects, []);

console.log(
  'Sync regressions passed: metadata-only rounds/counts, deletion ordering, project stamps, and v5 pre-apply guard.',
);
