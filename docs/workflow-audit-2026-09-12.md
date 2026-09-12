# Full workflow audit — 12 September 2026

## Result

This audit originally found four high-priority workflow/data-integrity defects,
four medium-priority defects and two incomplete/disconnected UI areas. The
remediation pass completed every verified finding below and also closed the two
previously recorded P1 sync-loss architectures before release.

The original repros used disposable browser storage and the isolated simulator
bundle `com.akhutaba.yoman.cards.emptyqa`. Final verification used the same synthetic
profiles, then installed and launched the frozen production build in place as
`com.akhutaba.yoman.cards` on the one authorized iPhone. It did not uninstall the app,
insert synthetic phone data or touch any other physical device.

## Remediation status — complete

| Finding | Status and final evidence |
|---|---|
| App-bar backup omits visible edit | Resolved. Backup and sync await the page-wide pending-write registry; the real download contained `VISIBLE BUT NOT YET AUTOSAVED`. Strict Mode replacement registrations have distinct tokens. |
| Entry URL paired with wrong project | Resolved. Route state resolves entry plus owner. Project A editor, preview and extracted PDF remained A while B was active. Missing, trashed and orphaned routes have localized recovery with no export. |
| Automatic backup reports stale copy as current | Resolved. The snapshot fingerprint covers projects, entries, contacts, presets, synced settings and tombstones; skipped/failed writes do not advance freshness. |
| Quantity/named-contractor reports unreachable | Resolved. `QuantityReportsPanel` is mounted on the same range-keyed live result. Reports-tab tests created and inspected concrete, steel and named-contractor PDF/XLSX files plus share. |
| Missing/deleted links create or spin | Resolved. Explicit loading/found/missing/deleted/orphaned states replace `loaded ?? fresh()`; delayed checks created zero accidental entries. |
| Double project Save | Resolved. A synchronous in-flight guard allowed exactly one creation; injected failed writes retained the dialog/input for retry. |
| Date-conflicted draft exports | Resolved. PDF/Image/Word/share require a successful prerequisite save. PDF and share bridge counts stayed unchanged on a real date conflict. |
| Project/Trash/contact/editor operations lack failure state | Resolved. Busy/error state, logging and retained retry state were exercised with native IndexedDB `QuotaExceededError` injection. |
| Sync says `0 in, 0 out` for metadata | Resolved. Outcomes count projects, entries, contacts, presets, settings and tombstones in both directions; metadata-only rounds pass. |
| Range preview restarts numbering per day | Resolved. Without a summary it uses global offsets and the whole-report total; with the PDF-only measured summary plan it leaves number slots blank instead of inventing a count. |

The formerly disconnected Cards workspace is now the production shell: functional
phone tabs, a desktop recent-day rail and the existing live A4 `SheetPreview` at wide
sizes. Neutral surfaces carry no category decoration; colour is reserved for status,
invalid/review state and destructive actions.

The prior review's same-UID and open-editor sync risks are also closed. Schema v8 and
protocol v5 use a content fingerprint plus per-device causal vector, deterministic
conflict branches and causal entry tombstones. Equal/skewed clocks, concurrent fields,
same-size different photo bytes, three peers, queued editor saves, restore, Trash and
delete-versus-edit all converge without silently discarding a branch. Unresolved
revision and deletion conflicts block every report until explicit resolution.

Severity means:

- **P1** — can omit work from a backup, put the wrong project on a document, overwrite
  newer work, or makes an explicitly implemented core report impossible to reach.
- **P2** — a repeatable broken/deceptive workflow with a recovery path.
- **P3** — misleading status or incomplete feedback without direct data loss.

## Verified findings

### Resolved P1 — Backup from the app bar omits the visible unsaved revision

**Trigger:** open a new day, type in the work description, and immediately press the
backup icon before the 1.2 second autosave finishes.

**Observed:** the downloaded backup contained no entry at all. On an existing day the
same path can contain the previous stored revision rather than the text still visible
on screen.

**Evidence:** a disposable Chromium profile created a project, typed
`VISIBLE BUT NOT YET AUTOSAVED`, immediately clicked the real app-bar backup button,
captured the JSON download, and found `entries[0]` absent. The editor deliberately
waits 1.2 seconds at `src/screens/EntryEditor.tsx:289-296`. The shell backup calls
`backupNow`/`backupToJson` directly at `src/App.tsx:217-236`; it has no editor flush.
This is also still listed as unresolved in `docs/project-review-2026-09-12.md`.

**Impact:** the backup UI says the copy was downloaded/saved even though the latest
visible work is not in it. This defeats the safety action at exactly the moment it is
most likely to be used.

**Suggested fix:** publish an awaited `flush` action from the active editor and make
both app-bar and Settings backup paths await it before snapshotting. Treat a failed
flush as a backup failure rather than silently copying the old revision.

### Resolved P1 — Entry routes do not validate project ownership and can produce a document for the wrong project

**Trigger:** make Project B active, then follow or return through browser history to
`#/entry/<id>` for a day owned by Project A.

**Observed:** the top bar said `Project B`, while the editor loaded Project A's date
and content. Export and preview functions receive the active `project` prop, so the
official document can carry Project B's heading/company over Project A's diary entry.

**Evidence:** the synthetic repro loaded an A entry dated 2026-08-01 under a B top bar.
`src/App.tsx:352-382` parses only the numeric id and passes the active project;
`src/screens/EntryEditor.tsx:143-149` loads the entry by id without checking
`projectId`/`projectUid`; export passes that entry with the active project at
`src/screens/EntryEditor.tsx:783-789`. `src/screens/PreviewScreen.tsx:20-38` has the
same independent lookup/active-project pairing.

**Impact:** editing still targets the original entry, but the screen context and
generated paperwork identify another construction project. A stale URL, browser Back,
or restored navigation state is enough to reach it.

**Suggested fix:** resolve entry plus owning project as one route state. If the owner
exists, either switch context explicitly with clear feedback or render/export using the
owner. If it is missing/deleted, show a recovery state and do not offer export.

### Resolved P1 — Automatic backup can mark a stale copy as current without writing a file

**Trigger:** after a backup, change only a project, document theme, saved signature,
logo, preset, or a permanent deletion, then launch after the 12-hour interval.

**Observed:** a project-only synthetic change caused `backupNow()` to return `"mac"`,
perform zero bridge writes, and advance `yoman-last-backup` as though the existing file
contained the change.

**Evidence:** `changedSinceLastBackup` checks only the newest entry and contact at
`src/lib/autoBackup.ts:79-86`. When it decides nothing changed, it advances the success
stamp and returns the target at `src/lib/autoBackup.ts:107-114`. Yet the backup includes
projects, presets and synced settings (`src/db.ts:952-987`) and permanent deletion
tombstones affect what a later restore/sync will do.

**Impact:** Settings can show a recent, healthy backup while the file lacks project
details, signatures, branding, settings, presets, or the latest permanent-deletion
state. A project created before its first diary day is a simple first-use example.

**Suggested fix:** maintain one durable mutation generation for every backup-owned
table, or compare maxima/counts for all relevant stores including tombstones. Advance
the last-backup stamp only after a real current snapshot exists.

### Resolved P1 — Delivery-note and named-contractor reports are implemented but unreachable

**Trigger:** record concrete/steel delivery notes or assign crew rows to address-book
contractors, then open Reports.

**Observed:** Reports offers the older workers-by-trade, equipment and casting-concrete
summary card. There is no UI route to concrete received, steel received, or worker-days
per named contractor.

**Evidence:** `src/components/QuantityReportsPanel.tsx:15-104` implements selection,
known subtotals, issue review, daily/source detail, PDF, Excel, share, and links back to
the source day. Repository search finds no import or render of `QuantityReportsPanel`.
`src/screens/ReportsScreen.tsx:307-314` renders only `SummaryExportCard`. The editor does
render `QuantityLedger` at `src/screens/EntryEditor.tsx:1062`, so data can be entered but
the promised output cannot be reached. Calculation/PDF/XLSX regressions themselves pass.

**Impact:** the user-facing feature described in
`docs/delivery-and-contractor-reports.md` is incomplete despite most implementation
being present.

**Suggested fix:** mount `QuantityReportsPanel` on Reports using the same range-bound
`entries` value and shared busy state. Add a browser reachability check that starts at
the Reports tab rather than importing the generator directly.

### Resolved P2 — Missing, purged, and deleted entry links have incorrect states

**Trigger A:** navigate to `#/entry/999999`. **Observed:** a blank editor for today's
date appears, with no indication the requested day was missing. Saving it creates a new
day. This comes from `loaded ?? fresh()` at `src/screens/EntryEditor.tsx:143-149`.

**Trigger B:** navigate to `#/preview/999999`. **Observed:** `Loading…` remains forever.
`useEntry` returns `undefined` for both loading and not-found
(`src/hooks/useData.ts:130-132`), and the preview maps both to loading at
`src/screens/PreviewScreen.tsx:27-38`.

**Trigger C:** keep a stale direct URL to a page that is now in Trash. **Observed:** the
editor/preview still loads the trashed record because the lookup does not filter
`deletedAt`; it has no dedicated trash/recovery state and can still export it.

**Impact:** a broken link can create an unintended new diary page, trap the user on an
endless loading screen, or bypass the normal trash workflow.

**Suggested fix:** use an explicit query state (`loading | found | missing | deleted |
wrong-project`) and render a localized recovery screen with Back, open Trash/restore,
or switch-project actions as appropriate.

### Resolved P2 — Double activation creates duplicate projects

**Trigger:** press Save twice quickly in the New Project dialog.

**Observed:** two projects with the same name were created in the disposable browser
database.

**Evidence:** two click events dispatched before the first promise settled produced a
count of 2. `src/screens/ProjectsScreen.tsx:27-43` has no in-flight guard, and the button
remains enabled at `src/screens/ProjectsScreen.tsx:134-143`.

**Impact:** common double taps on a slow phone can leave duplicate projects and an
unclear active context.

**Suggested fix:** one `busy` guard for create/update/switch/delete, disable dialog
actions while pending, and surface database failures without closing the dialog.

### Resolved P2 — A date-conflicted draft can still be exported

**Trigger:** edit a day, change its date to one already used by the project, then choose
PDF/Image/Word/share.

**Observed from the live control flow:** `persist(entry)` returns `false` on
`EntryDateConflictError`, but export continues immediately afterward at
`src/screens/EntryEditor.tsx:776-809`. Manual Save reports the conflict at
`src/screens/EntryEditor.tsx:752-756`.

**Impact:** the app can hand out a document representing a visible draft that it refused
to store. The user may believe the exported day exists safely in the diary.

**Suggested fix:** require `await persist(entry)` to return true before export/share,
and focus the existing conflict message when it returns false.

### Resolved P2 — Destructive/project/contact actions lack consistent busy and failure states

**Trigger:** make IndexedDB or the pre-delete backup fail, or press a Trash action more
than once while it is running.

**Observed from source:** project create/update/delete/switch await writes without
`try/catch` or disabling controls (`src/screens/ProjectsScreen.tsx:27-65`); Trash
restore/purge/empty has no busy state, and purge/empty exceptions escape
(`src/screens/TrashScreen.tsx:48-89`, `116-181`); contact add/delete and background
flush also allow re-entry or unhandled rejection (`src/screens/ContactsScreen.tsx:74-95`,
`129-152`, `219-249`). The editor's explicit Save awaits `persist` without catching
non-conflict storage errors (`src/screens/EntryEditor.tsx:752-756`).

**Impact:** a failed operation can look like a dead button, remain selectable while in
flight, or emit only an unhandled promise rejection. For the diary this is especially
dangerous because the UI can retain text that never reached storage.

**Suggested fix:** use per-operation busy/error state, keep dialogs/screens open on
failure, disable repeated activation, log the real operation, and show a localized
retryable error. Do not collapse all storage errors into “date already exists.”

### Resolved P3 — Sync success counts can say zero even when metadata changed

**Trigger:** sync only settings, presets, contacts sent from the client, or tombstones.

**Observed from source:** `SyncOutcome.sent` counts only projects and entries
(`src/sync/client.ts:179-183`, `343-368`), while the success toast displays only received
projects/entries/contacts and sent projects/entries
(`src/components/SyncCard.tsx:161-177`). Metadata-only protocol rounds are correctly
performed, but the visible success may say `0 in, 0 out`.

**Impact:** the transport works, but the status is not truthful enough to confirm why
the user pressed Sync.

**Suggested fix:** return and display complete sent/received counts by record class, or
use a nonnumeric “Up to date” result when exact metadata counts are intentionally hidden.

### Resolved P3 — Range HTML preview page numbers are local to each day

`ReportPreviewScreen` passes `1 + that day's photo pages` independently to every
`SheetPreview` at `src/screens/ReportPreviewScreen.tsx:79-81`, `165-181`. The generated
PDF numbers globally and may include a summary cover. This known limitation from the
prior review is still present and can make preview headers disagree with the document.

## Follow-up status for disconnected and proposed areas

### Desktop Cards workspace — connected

`src/components/CardsWorkspace.tsx` now supplies the production desktop recent-day
navigation, wide-screen live A4 preview and expanded preview dialog. `App` mounts the
desktop rail and `EntryEditor` mounts `CardsEditorLayout`; phone widths retain the six
functional tab controls and skip the hidden queries/preview.

### Apple-only iCloud sync is a proposal, not an implementation

The current Settings sync card accurately describes same-network Mac-hosted sync
(`src/components/SyncCard.tsx:1-7`, `287-293`). `src/sync/client.ts` uses HTTP to a paired
LAN address. The iOS project contains no CloudKit entitlement file or CloudKit sync
module, and the Mac build is unsigned (`electron-builder.yml`, `identity: null`). The
CloudKit/CKSyncEngine path in `docs/project-review-2026-09-12.md` is architecture work to
do; it must not be presented as a current capability.

The LAN sync is now protocol v5 with schema-v8 causal entry revisions and causal deletion
heads. The simultaneous same-UID and open-editor overwrite risks from the prior review
are covered by multi-peer and queued-editor regressions. CloudKit remains separate future
architecture and is not presented as current behavior.

## Checks that passed

- Fresh Chromium empty install in Hebrew and English: Diary, Reports, New, restore,
  cancellation, creation continuation and selected-tab state.
- Chromium iPhone profile: project creation, Save then New, repeated New, route-exit
  draft preservation, all 11 editor sections in both directions, short-height action
  menu, menu cleanup on navigation, and first tap after an incomplete swipe.
- Isolated iOS 26.4 simulator UI test: native taps through Diary, Reports and New empty
  states, project-create cancel, and restore navigation. One test, zero failures.
- Report browser checks: project/range scoping, quantity/contractor file reachability,
  live updates, conflict blocking, changed dates and Hebrew phone layout.
- Storage checks: atomic one-page-per-date rule, soft/hard-delete barriers, signed status,
  deleted-project barrier, settings backup/restore, monotonic future timestamps, photo
  migration race, route-exit save queue, delayed reopen and schema v6 to v8.
- Summary report generators: date/timezone cases, scoped rows/totals, spreadsheet formulas,
  PDF boundary/long text and concurrent Word themes.
- Quantity report generators: strict received totals, duplicate exclusion, kg conversion,
  stable contractor identity, issue output, PDF and recalculable XLSX.
- `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run sample` all passed.
- Rendered Hebrew diary and summary PDFs were visually inspected. The diary stayed on one
  A4 page; Hebrew and 31/07/2026 digit order were correct; signature and bottom blocks
  were present. The summary was legible and retained its table/detail hierarchy.

The build still emits nonfatal existing warnings that `save.ts`, `autoBackup.ts`, and
`reminder.ts` cannot be split by their dynamic imports because they also have static
importers, plus a chunk above 500 kB.

## Remaining validation limits

- The quantity Notes regression is repaired and green. The field data had persisted;
  after reload the textarea value became part of its wrapping-label text and broke the
  exact accessible-name locator. An explicit `aria-label` stabilizes the control. The
  suite's following wait was also stale because English long dates are numeric; it now
  asserts the real localized date.
- Native simulator UI passed one test with zero failures through Diary, Reports, New,
  project-create cancel and restore navigation. The signed production bundle installed
  in place and launched on the authorized iPhone. Real share sheets, Files permissions,
  notification scheduling, camera/photo picker, reinstall survival, large-photo LAN
  transfer, Excel desktop recalculation and offline PWA update behavior remain untested.
- The separate arm64 Cards Mac app and DMG were built, checksum-verified and launched
  from `release-cards` without replacing the original. Its user-data and automatic-backup
  folders are isolated. Both Mac editions still bind LAN port 45231; Settings visibly
  reports the busy port, and only one Mac sync host should run at a time.
- CloudKit remains planned architecture. This remediation ships the tested protocol-v5
  LAN sync and does not claim a CloudKit container, entitlement or transport.

## Final verification

- `npm run typecheck`, `npm run lint`, `git diff --check`, `npm run build` and
  `npm run sample` passed. The build retains only the known nonfatal chunk-size and
  ineffective-dynamic-import warnings.
- Summary and quantity generator checks passed; rendered Hebrew A4/summary and quantity
  PDFs were inspected for one-page geometry, bottom blocks, RTL text and digit order.
- Fresh-browser suites passed: report/quantity UI, empty navigation, mobile taps, Cards
  workspace, route recovery, mutation failures, storage/backup, sync protocol, causal
  sync matrix and causal conflict UI.
- The iOS 26.4 simulator build and XCUITest passed. The physical Cards app reports name
  `יומן עבודה כרטיס`, bundle `com.akhutaba.yoman.cards`, version 1.0/build 1 and launched
  successfully after the in-place install.
