# Project review — 12 September 2026

## What the project is optimizing for

The data lives in Dexie/IndexedDB; React is shared by the PWA, Electron Mac app,
and Capacitor iOS app. The primary product is a signed construction diary page,
not a dashboard: the PDF, Word document and HTML preview must agree with the
printed A4 form. Photographs and handwritten signatures make storage integrity
more important than visual redesign. Exports load their heavy libraries on demand.

The existing LAN sync is a two-way merge through the Mac's Electron HTTP host.
Each device owns its database and uses stable UIDs to match records. Numeric IDs
are local. Entries carry whole-day revisions and photos; deleting permanently
creates tombstones. Backups are separate recovery copies, not sync transports.

## Guidance incorporated

The root AGENTS.md already contained almost all of CLAUDE.md. The substantive gap
was its references to nonexistent scoped instructions. Added scripts/AGENTS.md,
src/sync/AGENTS.md and src/xlsx/AGENTS.md from their corresponding CLAUDE.md files.
Corrected the root's inaccurate Codex hook description; no hook was enabled or
changed. The existing .codex/hooks.json still references CLAUDE_PROJECT_DIR.

## Report change

The user confirmed: **each complete summary table should be a separate file**.
Reports now offer a choice of workers by trade, equipment or concrete. Exporting
one includes every row of that table, its totals, counted dates and original daily
source values. It excludes other tables and unrelated diary content. Each can be
saved as PDF or Excel; PDF can also be handed to the system share sheet.

The PDF retains long detail across pages. The workbook has summary formulas and
daily source rows; EXACT matching preserves the application's case-sensitive,
literal labels. No files were sent to other people during development.

The arithmetic preserves the existing first-number rule, now also recognizing
Arabic-Indic and Persian digits. A field such as `3 + 1` contributes 3, and
equipment hours are added as entered rather than multiplied by equipment quantity.
The standalone summary explains this and retains the source strings. Changing
these business rules should be a separate explicit decision.

## Design directions

1. **בשטח / On site:** One day, clear completion state, large sections and one next
   action. Best starting point for the phone.
2. **על השולחן / At the desk:** Day navigation beside the document and export
   controls. Best starting point for Mac and iPad.
3. **בשליטה / In control:** Dense report tables, contribution drilldown and a
   selected summary ready to share. Best for weekly review and reconciliation.

The three designs are interactive conversation mockups with synthetic figures.
They do not change the production application's design. The strongest combined
direction is 1 for phone entry and 2 for desktop, with the report interaction from 3.

In every direction, distinguish “saved on this device” from “received by another
device”; retain one main action; show section completion; show the precise scope
before sharing; and adapt navigation to touch versus desktop space.

## Sync recommendation — user's Apple devices through iCloud

The user confirmed that only their own Mac, iPhone and iPad need to sync. The
recommended next implementation is a **private CloudKit database in the user's
Apple account**, with CKSyncEngine for change transport and the current local
Dexie database retained for offline work. Background delivery is scheduled by
Apple, so the app must also offer foreground “sync now” and an honest pending
state. [CKSyncEngine](https://developer.apple.com/documentation/cloudkit/cksyncengine-4b4w9?language=objc).

A concrete implementation path:

1. Use one CloudKit container and a private custom record zone. Sign/configure both
   native apps for that container and the required CloudKit/notification entitlements.
2. Share a Swift sync module: a Capacitor plugin on iOS and a signed native bridge
   or helper in the Electron Mac app. Keep the web UI and IndexedDB data model.
3. Queue local changes durably before sending. Use the existing UID as the cloud
   identity, persist CKSyncEngine state, and acknowledge writes only after the
   server confirms them. Keep local numeric IDs out of the wire identity.
4. Transfer photos as separate asset records with stable IDs and checksums. Keep
   validated Uint8Array bytes locally for offline viewing and backups; do not
   overwrite a readable photo with a missing/partial download.
5. Preserve conflicting field edits with a base revision and conflict copy rather
   than comparing whole-day device-clock timestamps. Resolve two independent
   creations of the same project/date visibly; keep tombstones until peer state
   makes cleanup safe. A server transport alone does not solve those app rules.
6. Distinguish local save, pending upload, synced metadata and pending photos in
   the UI. Handle offline operation, iCloud quota/authentication errors and Apple
   account changes without clearing the local diary.

The current repository has no CloudKit entitlements/container configuration, and
`electron-builder.yml` explicitly builds the Mac app unsigned (`identity: null`).
Signing and container setup are prerequisites; the user's present Developer Program
membership has not been checked. Native CKSyncEngine requires CloudKit and remote
notification entitlements. [Apple configuration guidance](https://developer.apple.com/documentation/cloudkit/cksyncengine-4b4w9?language=objc),
[account capabilities](https://developer.apple.com/help/account/capabilities/capabilities-overview).

The first proof should use synthetic days and photos on two devices under the same
Apple account. Verify interrupted upload, lost acknowledgement, offline edits,
restore after deletion, reinstall with photos, quota errors and sign-out/sign-in.
Keep a backup and rollback path before migrating real data. This review did not
create containers, upload diary data, enable entitlements, or install the new sync.

Dexie Cloud was considered for a cross-platform/browser requirement, but the user's
Apple-only choice makes CloudKit the preferred direction. CloudKit JS remains an
option if browser support is wanted later; it needs web services and authentication
integration. [CloudKit JS](https://developer.apple.com/documentation/cloudkitjs).

## Confirmed bugs repaired in this pass

- Report month navigation overflowed on days 29–31 and some shortcuts shifted a
  local date through UTC. It now uses local calendar helpers.
- Report results were snapshots, and old-range rows remained exportable while
  a new range was loading. Live queries are now bound to the requested range.
- A summary table filling the PDF cover exactly could omit its total. The total
  now stays with the final data row on a continuation page.
- PDF cover columns and metadata were physically RTL even in English. They now
  follow the document direction.
- Concurrent Word builds could use another export's font/theme after waiting for
  photos. Theme state is now assigned after asynchronous reads.
- Spreadsheet status ignored a manager signature on older draft records.
- Arabic/Persian numeral input contributed zero to report totals.
- Tombstone-only and preset-only changes did not trigger a sync exchange.
- A local tombstone blocked even a newer restored record from being requested.
- A responder applied a mismatched protocol payload before checking its version.
- HTTP response bodies and pairing probes could stall outside the timeout.
- Project edits had no mutable sync revision; project deletions could erase a
  newer restored project. Schema v7 adds project modification stamps.
- Incoming sync records could lower a signed page to draft.
- Successful corrections to peer credentials were not persisted, and reopening
  the Mac window from the Dock failed to restart the host.

Sync is now protocol v5 and the database is schema v8. Entry manifests carry a
logical-content fingerprint and per-device causal version vector; entry tombstones
carry a causal deletion head. Update both devices together: a mixed v4/v5 pair is
refused before either side applies a payload.

- Leaving the editor during its debounce discarded the pending change; saves are
  now queued and flushed on route exit, and reopening waits for queued writes.
- Overlapping initial saves could race on UID/date and mark a newer edit clean.
  Revision tracking and atomic date checks now prevent those paths.
- Stale saves could resurrect trash or write into a deleted project; persistence
  now checks the current record, parent and deletion state.
- Startup Blob conversion overwrote whole stale entries. It now patches photo
  storage wrappers on the current record, retaining edits and photo metadata.
- Completing an image batch could overwrite intervening captions or removals.
  Batches use the latest photo list, and detached batches retain their original day.
- Backups omitted the logo, document theme and reusable signatures. Optional
  diary-owned settings now round-trip; device settings remain local. Explicitly
  cleared settings are restored as cleared and given a fresh sync stamp.
- A restore or clock adjustment could make the next local edit older than the
  stored record. Ordinary local writes now advance beyond known record stamps.
- Pending editor/contact writes register awaited flushers used by backup and sync.
  React Strict Mode registrations have distinct tokens in one page-wide registry,
  so an old cleanup cannot remove the live replacement.
- Same-UID offline edits now compare causal vectors. Sequential heads replace their
  ancestors, identical concurrent content joins vectors, and different content is
  preserved under deterministic branch IDs on every peer. Photo bytes participate in
  the fingerprint. Delete-versus-edit keeps and marks the recoverable edit until Save
  explicitly keeps it or Trash confirms deletion.
- The disconnected quantity panel and Cards workspace are now production UI. Reports
  block every unresolved revision or deletion conflict instead of double-counting or
  choosing a branch.

## Remaining findings and limits

- Pairing credentials are still generated in Mac process memory; restarting the
  process can require pairing again. Persistent pairing needs a deliberate
  secret-storage/rotation design.
- The LAN transport uses plain HTTP, a six-digit code, manual IPv4 entry and no
  attempt throttling. It is not an internet sync service; browser LAN access also
  depends on browser transport/security policy.
- Tombstones expire after 90 days without acknowledgements from every device;
  a long-offline device can reintroduce a permanently deleted record.
- Preset deletions have no tombstones; concurrent usage counts merge with max,
  so deletion/increment intent is not fully preserved.
- Chunking admits one complete diary entry, however large. A huge photo day can
  exceed the Electron host's 200 MB body limit. Photos need separate transfers.
- CloudKit remains a proposal. The shipped implementation is still the paired LAN
  transport; no CloudKit container, entitlement or migration was introduced here.
- The original and Cards Mac editions have isolated application data and backup
  folders, but both host LAN sync on port 45231. The second app reports the busy port;
  run one Mac sync host at a time.

## Validation

- npm run build, npm run typecheck, npm run lint and npm run sample.
- scripts/check-reports.ts: three timezones/month boundaries; duplicate-day
  counting; scoped source exclusion; spreadsheet formulas and signed status;
  exact PDF table boundary; long source preservation; concurrent Word themes.
- scripts/check-report-ui.mjs: fresh browser context, synthetic database, captured
  concrete/steel/named-contractor PDF/XLSX/share delivery, truthful page numbering,
  live edits, period changes, Hebrew mobile layout and revision/deletion report blocks.
- scripts/check-sync.ts: metadata-only requests, deletion/restore ordering,
  project revision requests and refusal of a mutating mismatched-version payload.
- scripts/check-storage.mjs: atomic date checks, route exit/reopen, deletion barriers,
  exact pending-edit backup, backup freshness for every store, conflict resolution,
  photo conversion races, and schema v6→v8 upgrade.
- scripts/check-causal-sync.mjs and check-causal-conflict-ui.mjs: two/three independent
  browser diaries, equal/skewed clocks, legacy heads, same-size different photos,
  deterministic/idempotent branches, queued canonical editor saves, restore, Trash,
  permanent-delete races, report blocking and explicit Keep.
- scripts/check-route-errors.mjs and check-mutation-failures.mjs: owner-correct stale
  links and exports, missing/deleted/orphan recovery, blocked conflicted exports,
  duplicate activation and injected IndexedDB failures with retained retry state.
- Visually reviewed generated Hebrew diary and Hebrew/Arabic summary PDFs for
  page geometry, signatures, mixed-script labels and date digit order.

The frozen production bundle built successfully, passed one isolated iOS 26.4 native
UI test, and was installed in place and launched as `com.akhutaba.yoman.cards` on the
authorized iPhone. A separate unsigned arm64 Cards Mac app/DMG was built and launched
from its release folder without replacing the original edition. Native share sheets,
real Mac-to-phone data transfer and Excel desktop recalculation were not exercised.
The browser checks use disposable profiles and send no files to real recipients.
Build emitted only the known nonfatal chunk-size/dynamic-import warnings.
