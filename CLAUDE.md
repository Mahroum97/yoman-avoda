# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An offline-first work diary for construction sites (יומן עבודה · سجل العمل · Work Diary).
The user fills in a day's page and exports a **designed PDF or Word document** based on
the printed A4 form in `יומן עבודה לעבודות בנייה.pdf` — that PDF is the origin of the
layout, and fidelity to its structure is the point of the project.

It ships three ways from one codebase: a **PWA**, a **macOS app** (Electron) and an
**iOS app** (Capacitor). React + TypeScript + Vite, IndexedDB via Dexie, `pdf-lib` and
`docx` for the documents. No server, no accounts.

## Commands

```bash
npm run dev          # dev server on :5173 (the Mac app in dev mode expects :5199)
npm run build        # tsc -b && vite build, plus the service worker
npm run typecheck    # types only
npm run lint         # oxlint
npm run sample       # writes tmp/sample-*.{pdf,docx}, including one page per language
npm run fonts        # re-downloads the embedded Hebrew/Arabic TTFs
npm run icons        # rasterises public/favicon.svg into PWA icons + build/icon.icns
npm run app:dev      # Electron against a running dev server
npm run app:build    # packages release/*.dmg and release/mac-arm64/*.app
npm run ios:sync     # build + copy the web assets into the iOS project
npm run ios:run      # build, sign and install on *every* connected iPhone and iPad
npm run deploy       # commit + push; GitHub Actions builds and publishes the site
npm run push         # one build → the Mac, every connected device, and the web
```

Xcode is installed but is not the selected developer directory on this machine, so every
iOS command sets `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` rather than
requiring `sudo xcode-select`.

`עדכון.command` at the repo root is the user-facing updater: double-clicking it installs
dependencies and then runs the push below, reporting progress in Hebrew.
`דחיפה לכל המכשירים.command` runs the push on its own, without reinstalling anything.

## Getting a build onto the devices

`scripts/push-all.sh` is the one way a build reaches the user. It builds the web assets
**once** and hands the same output to three independent legs — the Mac app (rebuilt and
copied into `/Applications`), every connected iPhone and iPad, and GitHub Pages.

- **No `set -e` in the push scripts, deliberately.** The legs must not depend on each
  other: an iPad that has not been trusted yet cannot be allowed to stop the Mac app from
  updating, and a missing GitHub remote cannot stop either. Each leg records its own
  outcome and the summary at the end reports what reached where.
- **Sub-scripts honour `YOMAN_SKIP_BUILD=1`**, which is how one push avoids running four
  identical Vite builds (`ios-install.sh`, `deploy-pages.sh`, and `app:build` each build
  on their own when run directly).
- **The web leg does not build anything.** `deploy-pages.sh` commits and pushes;
  `.github/workflows/deploy.yml` builds the site on GitHub and deploys it to Pages from
  the artifact, so the published site always comes from a committed state rather than
  from whatever happened to be in `dist/`. Pages is configured with `build_type=workflow`,
  so there is no `gh-pages` branch any more.
- **`scripts/ios-devices.py` is the only place that enumerates devices**, and it lists
  *all* of them. Both `ios-install.sh` and `ios-check.sh` read it. Stopping at the first
  device — which both used to do — silently skips a working phone whenever an unready
  iPad happens to enumerate ahead of it, and enumeration order is not stable.
- It checks **reachability first**: `devicectl` keeps listing a device long after the
  cable is out, still paired and with its developer mode remembered as enabled. Trusting
  that reported an unplugged iPad as ready and then failed deep inside `xcodebuild` with
  "unable to find a destination", which says nothing useful. No `transportType` means
  not connected, whatever else the record claims.
- It classifies pairing **before** developer mode: an untrusted device cannot report its
  developer-mode status, and the setting does not appear on it until it has been connected
  to a Mac it trusts. "Trust this computer" is genuinely the first step on a new device.
- The Mac leg asks the running app to quit before replacing the bundle, and **skips the
  replace** if it is still running after eight seconds rather than forcing it.

`scripts/push-reminder.sh` runs on Claude Code's `Stop` hook (`.claude/settings.json`) and
only prints a line when source files are newer than `.push-stamp`. It must stay a
reminder: `Stop` fires after every reply, so pushing from it would rebuild for minutes at a
time, put half-finished work on the phone mid-task, and publish unreviewed code to the web.

There is no test runner. **`npm run sample` is the regression check for the documents.**
After changing anything in `src/pdf/` or `src/docx/`, run it and *look* at the result:

```bash
npm run sample
pdftoppm -r 150 -png -f 1 -l 1 tmp/sample-entry-he.pdf tmp/preview   # then open tmp/preview-1.png
```

Check the page is one sheet, the Hebrew reads correctly, and **digits are not reversed**.

## The form is the spec

`src/types.ts` names every field after the printed form and records its Hebrew label in a
comment. `src/i18n/strings.ts` then holds the printed label in all three languages.

Sections, top to bottom: פרויקט / תאריך-מזג האוויר · רישום יומי של עובדים וציוד
(צוות הנהלה, קבלן, ציוד) · תיאור העבודה שבוצעה + פרטי יציקה · הערות המפקח +
התקבל היום + חתימות.

**The printed form is revised occasionally, and `  A יומן עבודה בבניה.pdf` is the
current one** — `יומן עבודה לעבודות בנייה.pdf` is the original the app was first built
from, kept for comparison. The bottom block is where they differ: the newer form added
**התקבל היום** (`receivedToday`, what was delivered to site that day) and moved the two
signature boxes side by side underneath it to make room. That block's total height did
*not* change, and must not: `METRICS.signatureBox * 2 + gap` is what the page budget
allows. When a field arrives this way it is **optional** in `DiaryEntry` and read with
`?? ''`, because pages written by an older build, restored from an older backup, or
synced from a device that has not been updated simply do not have it.

**Three renderers draw that one page, and they must move together:**

| | file | used for |
|---|---|---|
| PDF | `src/pdf/entryPage.ts` | the real deliverable |
| HTML | `src/components/SheetPreview.tsx` | on-screen A4 preview |
| Word | `src/docx/entryPage.ts` | the editable export |

The preview's CSS heights are the PDF's `METRICS` converted at 96dpi (1pt = 1.333px) and
are commented as such in `src/styles/global.css`. Change a height in one, change it in all.

## PDF rules (the parts that are easy to get wrong)

- **fontkit already reverses RTL runs.** Do not reorder strings yourself — that
  double-reverses the Hebrew. `src/pdf/bidi.ts` only pre-reverses the *Latin/number*
  segments (and mirrors brackets) so fontkit's reversal lands them the right way round.
  This is why `31/07/2026` inside Hebrew renders correctly. The file explains the whole
  chain; read it before touching anything text-related.
- **Every string goes through `Painter`**, which applies `pdfText` and picks the font. Two
  families are embedded in every document — Heebo (Hebrew+Latin) and Cairo (Arabic+Latin) —
  and the font is chosen *per string*, so a Hebrew diary stays readable in an Arabic report.
- **Positions are logical, not physical.** `axisFor(dir)` in `src/pdf/theme.ts` maps an
  offset from the start edge onto an x coordinate, which is how the same code prints
  right-to-left Hebrew/Arabic and left-to-right English. Use `p.textStart`/`axis.boxX`
  rather than hard-coding LEFT/RIGHT.
- Heights in `METRICS` are tuned so a full day fits **one sheet**. The original complaint
  about this app was a browser-printed PDF that spilled onto a second page with the
  browser's own header stamped on it; the generated PDF exists to make that impossible.

## Word rules

Widths are **twips** (1/20 pt) and `CREW_COLUMNS` must sum exactly to `CONTENT_WIDTH` or
Word silently rescales the table (`entryPage.ts` throws at import if it doesn't). Tables
set `visuallyRightToLeft: isRtl()`, so the first cell of a row is the start edge. Direction
is module state in `src/docx/theme.ts`, set by `setDocDirection()` at the top of a build —
a build is synchronous, so this is safe.

## Languages

`src/i18n/strings.ts` is a closed `Strings` type: adding a key without translating it into
he/ar/en is a compile error. The same dictionary feeds the UI *and* the documents, so
switching language in Settings changes the reports, their labels, the file names and the
writing direction. Language and theme both live in `localStorage` (not IndexedDB) because
`index.html` applies them before first paint to avoid a flash of the wrong theme/direction.

Date wording comes from the active language: `formatLongDate(iso, t)` in `src/lib/dates.ts`.

## Storage

`src/db.ts` owns all persistence.

- `entries` has a compound index `[projectId+date]` — **one page per project per day**.
  The editor checks for a clash before saving rather than creating a duplicate.
- Photos are `Blob`s inside the entry record, downscaled to 1600px JPEG by
  `src/lib/images.ts` *before* saving. The company logo is a PNG data URL in `settings`.
- Saving an entry runs `learnPresets`, which feeds the comboboxes.
- Backup is the only copy that leaves the device, so photos become data URLs there.
  **Settings must stay reachable with zero projects** (`App.tsx`) or restoring onto a new
  device is impossible — the onboarding redirect has an explicit exception for it.

## The diary list

`EntriesScreen` renders the same pages three ways: as a list, as a grid of tiles, and
in selection mode. The view menu (`ViewMenu.tsx`) mirrors the shape people already know
from file managers — select items · grid/list · sort — and picking the sort already in
use flips its direction rather than doing nothing.

- **View, sort and direction live in `localStorage`.** They describe the device, not the
  diary, so they must never reach `SYNCED_SETTINGS`: a phone and a Mac want different
  views of the same pages.
- **Month headings only appear while sorting by date.** Grouping pages by month under any
  other order produces headings that no longer describe what is under them.
- A tile previews the day's **first photo**, which is what makes a day recognisable on
  site; days without one fall back to a ruled sheet carrying the day number, so the grid
  keeps its rhythm instead of collapsing into empty boxes.
- `EntryTile` mints its object URL **and revokes it in the same effect** — the rule from
  the photo grid applies here for the same StrictMode reason.
- "דוח מהנבחרים" builds a range report from exactly the picked days, sorted oldest first
  regardless of how the list is ordered, because a report reads forwards.

`summary.ts` reads every field defensively. Pages the editor makes are complete, but one
can arrive from a sync or a restored backup written by an older version, and a single
absent quantity used to take the whole range report down.

### Pin and delete, by swipe

A list row is wrapped in `SwipeRow.tsx`: dragging toward the inline end uncovers **הצמד**
at the start edge, toward the inline start uncovers **מחק** at the end edge. Both flip
with the language, and both are also reachable from the selection bar, which is the only
way to do it in the grid or with a keyboard.

- **`pinned` belongs to the record, not the device** — unlike view and sort. The page you
  keep coming back to is the same page on the phone and on the Mac, so it travels in
  `WireEntry` and bumps `updatedAt` like any other edit.
- **Pointer events plus `touch-action: pan-y`, never touch events.** React attaches
  `touchstart`/`touchmove` at the root as *passive* listeners, so `preventDefault` in a
  React touch handler is discarded — the same trap the signature pad hit. `pan-y` leaves
  vertical scrolling to the browser and needs no `preventDefault` at all.
- **A gesture is owned by its `pointerId`, and an up from any other pointer is ignored.**
  `pointercancel` is not guaranteed to arrive — iOS drops it when a swipe races the
  scroller — which used to leave a row armed so the *next plain tap on it* ran the action.
  A tap deleting a day's page is the worst thing this component could do.
- **The panels do not use `--accent`/`--danger`.** Those are lightened at night to read as
  text on a dark page; as a fill behind white they fall to about 2:1. A swipe panel is a
  fill, and "delete" should not change colour with the time of day.
- **Deleting offers an undo instead of a confirmation.** `toast.show` takes an optional
  action for it and stays up for 7s rather than 3.2s when there is one. `restoreEntry`
  drops the tombstone along with putting the record back — leaving it would let the *other*
  device delete the page again on the next sync, outliving the undo.

## Spreadsheet export

`src/xlsx/` writes a real .xlsx by hand — an xlsx is a zip of XML parts, and jszip is
already in the tree because `docx` builds on it. A spreadsheet library was not worth its
weight for this, and writing the parts directly buys the thing a generic library will not
give: **`<sheetView rightToLeft="1"/>`**, without which a Hebrew workbook opens mirrored
with column A on the wrong side.

Quantities are written as **numbers**, not as the free text the form stores, or a column
of workers will not sum — which is the only reason to export a spreadsheet rather than a
PDF. `npm run sample` writes `tmp/sample-range-{he,en}.xlsx`; check both, since the RTL
flag changes the sheet XML.

## The activity log

`src/lib/log.ts` is how a fault on site becomes fixable. There is no console on a
phone in a building site, so the app records what it did and Settings → יומן אירועים
exports it through the same `saveBlob` share sheet the reports use.

Four levels — debug · info · warn · error — with `info` the default. Three rules are
load-bearing:

- **Logging never throws.** Every path swallows its own failures; a lost line is the
  worst case. `flush` drops its batch rather than retrying, because retrying grows the
  buffer without bound when storage is full.
- **The diary's contents never go in.** Counts, dates, sizes and language — never work
  descriptions, worker names, notes or photos. **File names are redacted through
  `fileKind()`**: export names are built from the project name, and this file gets sent
  to other people. The privacy line in the card is a promise the code has to keep.
- **The level lives in localStorage, not IndexedDB** — a broken database is exactly when
  the log matters, so deciding what to record must not depend on it.

`log.ts` reaches the `logs` table through a dynamic `import('../db')`, and `db.ts` imports
only the *type* back. That is deliberate: it keeps `log.ts` safe to import from anywhere,
including modules the database itself depends on, with no cycle at runtime.

`describe()` handles a cross-engine detail worth keeping: V8 stacks already begin with
`Name: message` while JavaScriptCore's are bare frames, so the message is added only when
the stack lacks it — otherwise it prints twice on the Mac and vanishes on the phone.

`installGlobalLogHandlers()` runs first in `main.tsx`, before anything can fail, and
flushes on `visibilitychange` rather than `unload` — iOS does not reliably fire the latter
when an app is backgrounded.

## iOS

- **There is no downloads folder on iOS.** `src/lib/save.ts` therefore routes exports to
  the iOS share sheet — through Capacitor's Filesystem+Share in the native app, and the
  Web Share API in Safari. A `<a download>` silently does nothing in a web view, so never
  reach for `saveAs` directly; call `saveBlob`/`saveBinary`.
- Installing to the home screen from Safari requires **HTTPS**, which is why `npm run
  deploy` exists. Over plain http the app still runs but the service worker will not
  register, so it will not work offline.
- iOS zooms the page when a focused input is under 16px and never zooms back; the phone
  breakpoint in `global.css` pins form fields to 16px for that reason.
- Safe-area insets are applied to the top bar, the tab bar and the toast. `viewport-fit=cover`
  in `index.html` is what gives those insets real values.
- The native shell skips the service worker (`main.tsx`): Capacitor already serves the
  built files locally, and a second cache in front of them only causes stale assets.

## Local-network sync

Two devices each hold a full copy of the diary; syncing is a **merge**, not a
client talking to a server. `src/sync/` holds the whole thing:

- `protocol.ts` — the wire types and `whatToRequest`. The exchange is two steps
  on purpose: manifests first (uid + updatedAt, a few kB), then only the records
  the other side actually lacks. Photos are why — sending whole entries to
  discover they are identical would make syncing over Wi-Fi unusable.
- `store.ts` — turns the local diary into wire records and merges them back.
- `client.ts` — `syncNow` (the phone) and `answerExchange` (the Mac). Both sides
  run the same merge code.

**The exchange is chunked (protocol v2).** v1 sent the whole diary in one request
and could not finish once real photos were in it — the body had to be held in memory
three times over (built on the phone, sent, forwarded over IPC by the Mac). A sync is
now: manifests → pull in chunks → push in chunks, each round bounded to ~4 MB. Both
devices must run the same version; a mismatch is reported rather than half-applied.

Four things that made it slow, all fixed and all easy to reintroduce:

- **`buildManifest` must never read records.** It needs `uid` and `updatedAt`, but
  `entries.toArray()` deserialises every photo Blob with them — and a manifest is built
  twice per sync. It reads the `[uid+updatedAt]` compound index with `.keys()` instead,
  which is the only reason that index exists.
- **The responder bounds its reply by weight**, so it may return fewer entries than were
  asked for. The caller advances by *what arrived*, not by what it requested; a reply is
  a prefix, not a refusal. Nothing at all means those pages are gone, so the slice is
  skipped rather than retried forever.
- **`applyPayload` decodes photos before opening its transaction.** A Dexie transaction
  commits the moment it awaits a non-Dexie promise, so decoding inside it would end the
  transaction underneath the writes; it also used to run every read and write as its own
  transaction, hundreds per sync.
- **`dataUrlToBlob` uses `atob`, not `fetch`.** `fetch(dataUrl)` pushes every photo
  through the network stack, in a loop, on a phone.

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
- The Mac never auto-syncs: it is the host and has no peer stored, so the hook is inert
  there without needing to know what kind of device it is on.

Rules that are easy to get wrong, and are load-bearing:

- **Numeric ids are local.** Dexie's auto-increment collides across devices, so
  every project and entry carries a `uid`, and entries carry `projectUid` so an
  incoming entry can be relinked to whatever local id the project has here.
- **Deletions need tombstones.** Without them a record deleted on one device is
  simply re-sent by the other and comes back. `applyPayload` consults *both*
  sides' tombstones; a record whose incoming `updatedAt` is newer than the
  tombstone does return, which is last-write-wins applied to deletes.
- Conflicts are resolved by `updatedAt`, last write wins — correct for one
  person with two devices, which is what this is for.

The Mac hosts: `electron/sync-server.js` listens on port 45231 behind a
six-digit code. It cannot read the diary itself (IndexedDB belongs to the
renderer), so every request is forwarded to the window over IPC and the answer
is matched back by id. iOS needs `NSLocalNetworkUsageDescription` and
`NSAllowsLocalNetworking` in Info.plist, or the phone cannot reach it at all.

## Conventions

- One hand-written stylesheet, `src/styles/global.css`, custom properties + BEM-ish names.
  No framework. Touch targets are `--tap` (46px): the app is used outdoors, with gloves.
- Use logical CSS (`inline-start`/`inline-end`), never `left`/`right` — the app flips.
- Routing is a ~40-line hash router (`src/hooks/useRoute.ts`); hash URLs let the built app
  run from a plain folder or inside Electron's `file://`.
- `pdf-lib` and `docx` are large, so the export modules load via dynamic `import()` at the
  click. Keep it that way.
- Object URLs for photos are created **and revoked in the same `useEffect`**. Creating them
  during render and revoking in a cleanup breaks under StrictMode's double-invoked effects.
- Exports go through `src/lib/save.ts`, which uses the Electron bridge when present
  (native save dialog) and falls back to a browser download.

## Deliberate deviations from the printed form

The original prints `חתמת מנ"ע` (missing yod); the app uses the correct `חתימת מנ"ע`.
Everything else follows the form as drawn.
