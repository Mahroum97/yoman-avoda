# src/sync/ — local-network sync

Loaded when working in `src/sync/`. The Mac half of this lives in
`electron/sync-server.js`, which the same rules govern.

Two devices each hold a full copy of the diary; syncing is a **merge**, not a
client talking to a server. `src/sync/` holds the whole thing:

- `protocol.ts` — the wire types and `whatToRequest`. The exchange is two steps
  on purpose: manifests first (uid + causal revision, a few kB), then only the records
  the other side actually lacks. Photos are why — sending whole entries to
  discover they are identical would make syncing over Wi-Fi unusable.
- `store.ts` — turns the local diary into wire records and merges them back.
- `client.ts` — `syncNow` (the phone) and `answerExchange` (the Mac). Both sides
  run the same merge code.

**The exchange has been chunked since protocol v2.** v1 sent the whole diary in one request
and could not finish once real photos were in it — the body had to be held in memory
three times over (built on the phone, sent, forwarded over IPC by the Mac). A sync is
now: manifests → pull in chunks → push in chunks, each round bounded to ~4 MB. Both
devices must run the same version; a mismatch is reported rather than half-applied.

**Protocol v5 gives every entry a causal version vector plus a logical-content
fingerprint.** It distinguishes sequential edits from concurrent branches even when
device clocks are skewed or timestamps are equal. Concurrent content gets deterministic
branch UIDs, so both peers keep the same alternatives and repeated/reversed sync cannot
grow duplicates. A mixed v4/v5 pair is refused before mutation. **Protocol v4 preserves
two independently-created pages for one project/date.** **Protocol v3 made metadata
changes plan a round of
their own.** Tombstones and
presets travel in the small metadata payload, but in v2 that payload was sent only when
a project, entry, contact or setting also differed. A permanent deletion on its own
could therefore report a successful sync without ever leaving the device that made it.
The manifest now marks changed tombstones and preset counts explicitly, and the
responder checks the protocol version before applying any payload.

Four things that made it slow, all fixed and all easy to reintroduce:

- **`buildManifest` must never read records.** It needs the uid, timestamp and causal
  revision, but
  `entries.toArray()` deserialises every photo Blob with them — and a manifest is built
  twice per sync. It reads the `[uid+updatedAt+syncRevision]` compound index with
  `.keys()` instead. Schema v8 backfills legacy rows into that index.
- **The responder bounds its reply by weight**, so it may return fewer entries than were
  asked for. The caller advances by *what arrived*, not by what it requested; a reply is
  a prefix, not a refusal. Nothing at all means those pages are gone, so the slice is
  skipped rather than retried forever.
- **`applyPayload` decodes photos before opening its transaction.** A Dexie transaction
  commits the moment it awaits a non-Dexie promise, so decoding inside it would end the
  transaction underneath the writes; it also used to run every read and write as its own
  transaction, hundreds per sync.
- **`dataUrlToBytes` uses `atob`, not `fetch`.** `fetch(dataUrl)` pushes every photo
  through the network stack, in a loop, on a phone. Photos are carried as bytes on both
  sides — never as Blobs, for the reason `src/lib/photoData.ts` gives — so decoding is
  now synchronous and there is nothing to await inside the loop at all.

`post()` carries an `AbortController` — `fetch` has no timeout of its own, and without
one a sleeping Mac left the phone spinning for as long as the platform felt like waiting.
That was "it takes ages and then fails".

**Sync runs by itself** (`src/hooks/useAutoSync.ts`, mounted once in `App`). It fires on
open, on returning to the foreground, on regaining the network, and every five minutes —
and it is shaped as much by what it refuses to do:

- **It only runs while the app is visible.** A web app cannot sync while closed, and a
  timer that fires in a hidden tab would drain a phone for nothing.
- **A sync that moves nothing says nothing.** Only a sync that actually transferred
  records raises a toast; failures go to the log alone, because a phone on a site drops
  off the Wi-Fi constantly and a toast each time would be noise.
- **`syncNow` holds a module-level lock** (`isSyncing()`), so the button and the timer can
  never run at once — two overlapping syncs would have both sides merging each other's
  half-delivered chunks.
- **Pending editors flush before the manifest.** A debounced revision that exists only
  in React state has no stamp for the peer to compare, so `syncNow` awaits the same
  registered write flushers a backup uses before inventorying IndexedDB.
- The Mac never auto-syncs: it is the host and has no peer stored, so the hook is inert
  there without needing to know what kind of device it is on.

Rules that are easy to get wrong, and are load-bearing:

- **Numeric ids are local.** Dexie's auto-increment collides across devices, so
  every project and entry carries a `uid`, and entries carry `projectUid` so an
  incoming entry can be relinked to whatever local id the project has here.
- **Deletions need tombstones.** Without them a record deleted on one device is
  simply re-sent by the other and comes back. `applyPayload` consults *both*
  sides' tombstones. Entry tombstones carry a causal deletion head: a later deletion
  wins, a later restore/edit returns, and a deletion concurrent with an edit keeps and
  marks the edit until Save chooses keep or Delete confirms deletion. Wall-clock order
  remains only as the compatibility fallback for old tombstones and other tables.
- Revisions of the same uid use their vectors. A dominating revision replaces its
  ancestor; concurrent identical content joins vectors without a duplicate; concurrent
  different content preserves both under stable identities. A checked open editor uses
  the same rule if its loaded head changed behind the draft.
  **Two different uids for the same project/date are never resolved by deleting one:**
  both pages stay live with `syncConflict`, reports refuse to count an unresolved pair,
  and moving one to Trash clears the survivor's marker. Conflict kind distinguishes two
  live revisions from one live edit racing a deletion, so the UI and reports describe and
  block both honestly. Content fingerprints hash photograph bytes; a legacy Blob that
  cannot be verified is treated conservatively rather than declared equal.
  **The photograph availability exception remains:** `keepReadablePhotos` refuses to replace one whose
  bytes are here with one that arrived empty, so a device whose pictures were
  damaged cannot carry that across and overwrite the last good copy.
- Sync outcomes count projects, entries, contacts, presets, settings and tombstones on
  both sides. Metadata-only work must never be reported as `0 in, 0 out`.
- **`SYNCED_SETTINGS` is a closed list**: the company logo, the document theme and the two
  signatures. Everything else in `settings` stays on the device it was set on. The test is
  whether the value describes the diary or the device holding it.

The Mac hosts: `electron/sync-server.js` listens on port 45231 behind a
six-digit code. It cannot read the diary itself (IndexedDB belongs to the
renderer), so every request is forwarded to the window over IPC and the answer
is matched back by id. iOS needs `NSLocalNetworkUsageDescription` and
`NSAllowsLocalNetworking` in Info.plist, or the phone cannot reach it at all.
