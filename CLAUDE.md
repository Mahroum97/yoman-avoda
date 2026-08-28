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
npm run sample       # writes tmp/sample-*.{pdf,docx,xlsx}, including one page per language
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

`scripts/push-all.sh` is the one way a build reaches the user: it builds the web
assets once and hands the same output to three independent legs — the Mac app, every
connected iPhone and iPad, and GitHub Pages. **The rules that keep those legs from
taking each other down live in `scripts/CLAUDE.md`**, next to the scripts themselves.

`scripts/push-reminder.sh` runs on Claude Code’s `Stop` hook (`.claude/settings.json`)
and only prints a line when source files are newer than `.push-stamp`. It must stay a
reminder: `Stop` fires after every reply, so pushing from it would rebuild for minutes
at a time, put half-finished work on the phone mid-task, and publish unreviewed code.

There is no test runner. **`npm run sample` is the regression check for the documents.**
After changing anything in `src/pdf/` or `src/docx/`, run it and *look* at the result:

```bash
npm run sample
pdftoppm -r 150 -png -f 1 -l 1 tmp/sample-entry-he.pdf tmp/preview   # then open tmp/preview-1.png
```

Check the page is one sheet, the Hebrew reads correctly, and **digits are not reversed**.
It also writes `tmp/sample-range-{he,en}.xlsx` and `tmp/sample-contacts-{he,en}.pdf` —
every document the app can produce except the picture, which needs a browser to
rasterise. `scripts/bundle.mjs` is what lets browser modules run under Node for this:
esbuild bundles the entry point and stubs Vite’s `?url` asset imports, since the Node
path passes the font bytes in explicitly.

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

**The crew table is the one block on the page that grows.** The form draws six ruled
rows and the page budget was built for them; there is room for eight before the blocks
underneath — the description, the notes, what was delivered, the two signatures — are
pushed off the bottom edge, which is what a day with fourteen trades on it did, silently,
printing a page with no signatures on it. `src/lib/crewLayout.ts` divides the room the
rows are allowed instead, and both the PDF and the preview read it.

**Three renderers draw that one page, and they must move together:**

| | file | used for |
|---|---|---|
| PDF | `src/pdf/entryPage.ts` | the real deliverable |
| HTML | `src/components/SheetPreview.tsx` | on-screen A4 preview |
| Word | `src/docx/entryPage.ts` | the editable export |

The preview's CSS heights are the PDF's `METRICS` converted at 96dpi (1pt = 1.333px) and
are commented as such in `src/styles/global.css`. Change a height in one, change it in all.

**`src/docTheme.ts` is the fourth thing they share.** The five named palettes (navy ·
graphite · sky · olive · amber) are hex because that is what Word wants, and the PDF
converts them; all three renderers read the same definition so a report looks the same
wherever it was produced. Every palette has to stay legible **printed in black and
white** — the form is printed and signed on site — which rules out mid-tone bands with
white text on them. The choice lives in the `settings` table, not localStorage, and is in
`SYNCED_SETTINGS`: the look of a company's reports belongs to the diary, not to a device.

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
- **Nothing may be drawn past the bottom of the page, and nothing says when it is.**
  pdf-lib will put a tile at y=980 on an 842pt page without complaint; it is simply not
  there afterwards. Three blocks grow with the data and each has to answer for itself:
  the photo appendix breaks at `PHOTOS_PER_PAGE`, the cover's tallies break through
  `planSummary`, and the crew table tightens rather than breaking
  (`src/lib/crewLayout.ts`). All three were found the same way — a real day's export
  with the last of it missing.
- **A block that grows must be planned before the first page is drawn.** `דף N מתוך M`
  is printed in every header, so M has to be known before page one exists. `planSummary`
  therefore measures the tables into pages and returns them, and the appendix's page
  count comes from the same constant its drawing loop uses. When those two were separate
  numbers the count said four pages and the document had two.
- **A string is bounded by the box it is in.** `TextOptions.maxWidth` shrinks it and, in
  the last resort, cuts it with an ellipsis; `textCellBox` wraps it onto two lines first,
  which is what a table row has the height for. Without it `אינסטלטור צוות ספרינקלרים`
  printed straight across the rule and into the column beside it. Every fixed box passes
  one: the crew cells, the panel values, the header band, the summary tables.

## Word rules

Widths are **twips** (1/20 pt) and `CREW_COLUMNS` must sum exactly to `CONTENT_WIDTH` or
Word silently rescales the table (`entryPage.ts` throws at import if it doesn't). Tables
set `visuallyRightToLeft: isRtl()`, so the first cell of a row is the start edge. Direction
is module state in `src/docx/theme.ts`, set by `setDocDirection()` at the top of a build —
a build is synchronous, so this is safe.

## A page as a picture

`src/pdf/toImage.ts`. A PDF arrives in WhatsApp as a file to download and open; a picture
arrives as something already on screen, which on a site is the whole difference. A day and
a range report can both be exported as JPEG, through the one route in `exportImage`:
**one page becomes a `.jpg`, several become a `.zip`** of `…-01.jpg`, padded so ten pages
sort as 01..10 rather than 1, 10, 2.

- **The picture is the PDF, rasterised — not a fourth renderer.** The exported bytes are
  handed to pdf.js, so every embedded font, column width and wrapped line is whatever the
  document has. Drawing the page again would be a fourth thing to keep in step with
  `METRICS`, and the first person to notice it had drifted would be the supervisor holding
  both files.
- **pdf.js loads at the click**, like `pdf-lib` and `docx`. It is the largest thing in the
  tree and most days end with a PDF or with nothing.
- **`workerPort`, never `workerSrc`, and a fresh worker per export.** pdf.js ships its
  worker as an ES module; given only a `workerSrc` it starts it as a *classic* script,
  which dies on `import.meta` — and pdf.js then logs `Setting up fake worker` at warning
  level and runs the parser and rasteriser **on the main thread**. Everything still works,
  which is why this hid: the only symptom is the interface frozen for the length of the
  export, and on a thirty-page report that is the difference between a progress bar and a
  dead app. The fix is `new Worker(url, { type: 'module' })` passed as `workerPort`, built
  again for each export — `doc.destroy()` terminates whatever port it was given, and a
  dead port does not fall back to anything, it simply never answers.
- Canvases are released page by page (`canvas.width = 0`, `page.cleanup()`): thirty
  full-size canvases held at once is how a tab gets killed on a phone. Rasterising every
  page is the slowest thing the app does.

## The previews

Two screens show the document before it exists — `PreviewScreen` for a day,
`ReportPreviewScreen` for a range. They are the only users of `SheetPreview`, the HTML
renderer of the three, so what is on screen is what comes out.

- **The range preview stops short of the summary cover page.** That page belongs to the
  PDF builder, and an HTML copy of it would be the fourth renderer this project spends its
  effort avoiding. The preview also draws at most `MAX_SHEETS` (12) days — a quarter's
  report is ninety A4 sheets of live DOM — and says how many of the days are shown. The
  report itself is never truncated.
- **`SheetScaler` uses `zoom`, not `transform: scale()`.** Sheets are drawn at their real
  794px (210mm at 96dpi) so the preview cannot lie about the printed page; `zoom` shrinks
  the layout box itself, so the surrounding page height comes out right and nothing has to
  be re-centred in a container that may be RTL or LTR. It measures the clipping frame's
  `clientWidth` — the one measurement the oversized sheet inside cannot feed back into —
  and `@media print` resets the zoom to 1, because paper gets the real size.
- **Printing on the phone means exporting.** A web view has no print dialog, so
  `needsShareToPrint()` sends the print button to the PDF and the iOS share sheet, where
  Print sits beside Save to Files.

## Photos

The heaviest thing the diary holds, and the easiest to lose.

- **A photograph is stored as bytes, never as a `Blob`.** This is the one rule here that
  cost a day's work to learn. A Blob in IndexedDB is not kept in the record: the browser
  writes the body to a file beside the database and stores a reference. On iOS that
  reference does not survive **installing a new build of the app** — the entries come
  back with their captions, their sizes and their dimensions, and every picture in them
  is gone. The page then exports as a diary page with ten empty slots in it. A
  `Uint8Array` is structured-cloned into the record itself and travels with it through a
  reinstall, a backup, and the sync. `src/lib/photoData.ts` is the only place that reads
  or writes them; records written before the change still carry `blob`, so both are read
  and only `bytes` is written.
- **The conversion runs once, over the whole diary** (`rewritePhotosAsBytes`, scheduled
  in `main.tsx`). Converting on save alone leaves every page nobody opens still holding
  Blobs, and those are exactly the ones the next install breaks. It walks a page at a
  time, never throws, and **leaves `updatedAt` alone**: the bytes are the same photograph
  in a different wrapper, and stamping every page would push the whole diary over the
  next sync and win every conflict on the other device.
- **The sync never replaces a photo it can read with one it cannot.** Last write wins is
  right for a page and wrong for the picture inside it: a device whose photographs had
  been damaged would otherwise carry the damage across and overwrite the only good copy
  left, with a newer stamp making it look deliberate (`keepReadablePhotos`).
- **They are written the moment they are picked**, not on the editor's 1.2 second
  debounce. Everything else on the page can be typed again; a photograph taken in a
  stairwell at ten past seven cannot, and iOS can end the app inside that second and a
  bit. `persistPhotos` in `EntryEditor` is that write.
- **`usePhotoUrls` mints the URLs, and `URL.createObjectURL(photo.blob)` must not be
  called directly.** A Blob read back from IndexedDB is backed by a file, and on iOS the
  URL minted for one after the app has been closed and reopened often will not load in an
  `<img>`: the day comes back as a grid of broken squares while the same photos still
  export into the PDF, because building a document reads the bytes instead. The hook
  reads the bytes up front where the fault lives and repairs the rest on `onError`; it
  also keys URLs by photo id, because an effect keyed on the photos array revoked and
  re-minted every one of them on each keystroke of a caption.
- **One unreadable file must not throw out the batch.** Fifteen photos prepared in a
  single `try` meant one the phone could not decode — a video picked by accident, a
  format the web view will not read — discarded the other fourteen and showed an error
  naming none of them. Each file is prepared on its own and `photosSkipped` says how many
  did not make it.
- **There is no limit on how many a day can hold.** What limits the picker on an iPhone
  is iOS: an app given access to *selected photos* rather than the whole library can only
  offer what was selected. Adding more is a second trip through the picker; the app
  appends.
- **The appendix is `PHOTOS_PER_PAGE` photos to a page** — the count, the PDF and the
  preview all read it from `src/lib/photoPages.ts`, and `src/pdf/build.ts` throws at
  import if the geometry no longer agrees with it.

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
- Photos are **bytes** (`Uint8Array`) inside the entry record, downscaled to 1600px JPEG
  by `src/lib/images.ts` *before* saving — see the Photos section for why they are not
  `Blob`s. The company logo is a PNG data URL in `settings`.
- Saving an entry runs `learnPresets`, which feeds the comboboxes.
- **The schema is at v6, and every version restates every store.** The comment above
  each says what it changed and why: v2's `uid`s and tombstones, v4's `[uid+updatedAt]`
  indexes (so sync can build a manifest without deserialising photos), v6's `contacts`.
- **The status is derived, and only ever rises.** `statusFor` reads a page carrying a
  מנ"ע signature as `signed`, whatever the stored value says; without a signature the
  stored value is left alone, so marking a page by hand still works for the days that
  were signed on paper. Schema v5 changed no tables — it exists only to backfill that
  rule onto pages signed before it existed, which would otherwise sit as drafts forever.
- **Signatures and the logo live in `settings`, not on the entry.** They belong to the
  person and the company rather than to a day, which is the whole point — signing a page
  by hand every morning on a phone is the job the app removes. An entry still stores its
  own copy of whatever was applied, so a signed page stays signed after the saved
  signature is changed or deleted.
- Backup is the only copy that leaves the device, so photos become data URLs there.
  **Settings must stay reachable with zero projects** (`App.tsx`) or restoring onto a new
  device is impossible — the onboarding redirect has an explicit exception for it.
- **`restoreFromJson` clears the tombstones and stamps every restored page with
  `updatedAt = now`.** Both halves are load-bearing, and without them a restore is undone
  by the next sync. A tombstone carries the moment of the deletion, which is necessarily
  *later* than the `updatedAt` a page had when the backup was written, so the merge reads
  the restored page as the older of the pair and deletes it again — locally from our own
  leftover tombstone, and from the peer's, which it keeps for ninety days and re-sends.
  Stamping is the same rule `restoreEntry` applies after a swipe-undo, and for the same
  reason: a restore is meant to be the last write.

`db.ts` logs its own writes — pages saved, deleted and restored, projects created and
deleted, backups written and read, and the database failing to open. It is a *value*
import of `logger`, which is safe because `log.ts` reaches back only through a dynamic
`import('../db')`; the two never form a cycle at load time. Counts, dates and sizes
only — never a project name, since export file names are built from it and `fileKind`
already redacts those.

## Nothing may be lost

The diary is the only copy of a day that has already happened, so the rules that
keep it are worth more than any feature in this file.

- **The two operations that destroy data take a copy of it first.** Restoring a
  backup clears every table, and deleting a project hard-deletes its pages —
  tombstoned, so the other device deletes them too and there is nowhere left to
  go back to. Both call `backupNow({ force: true })` before they begin, which
  writes the current state to the Mac's backups folder or the phone's Documents.
  Neither is blocked by a device that cannot write one; a browser says so in the
  log and carries on with what the user asked for.
- **A restore is asked with numbers, not adjectives.** `inspectBackup` reads the
  file without touching anything — pages, photographs, the last date in it —
  and the question names them against what is on the device. A backups folder is
  a list of near-identical names, and one of them is usually a copy taken while
  the diary was empty: 137 bytes, and the warning used to read exactly the same
  for it as for the right file. A file with no pages at all, offered against a
  diary that has some, is asked twice.
- **Photographs are written the moment they are picked**, rather than on the
  editor's debounce — see the Photos section above.
- **The status only ever rises and the trash is a soft delete**, both covered
  under Storage; the point they share is that no ordinary action in the app is
  allowed to end with less diary than it started with.

## The editor

`EntryEditor` holds the day's page in `useUndoable` (`src/hooks/useUndoable.ts`), which is
an undo/redo stack over local state. A form filled in over dozens of small taps, outdoors,
had no way back from one mistaken one — a cleared row, a signature drawn over, a wrong
date. Two distinctions in it are load-bearing:

- **`commit` records a step, `amend` does not.** Adopting the id from a first save, or the
  status the database settled on, is bookkeeping the user did not do; putting it on the
  stack would make undo walk backwards through changes nobody made.
- **Not every change is its own step.** Consecutive `commit`s carrying the same tag inside
  `COALESCE_MS` fold into the step already on the stack, so typing a sentence undoes as a
  sentence rather than a letter at a time.

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

## סל מחיקה — deleting a page does not destroy it

Deleting a diary page is a **soft delete**: `deletedAt` is stamped on the record
and it leaves the list, the reports, and every total. `purgeEntry` is the only
thing that destroys one, and it is reachable only from the trash screen.

- **The tombstone is the whole distinction.** A soft delete writes none — the
  page still syncs, and turns up in the *other* device's trash rather than
  vanishing from it. Only emptying the trash writes a tombstone, because only
  then is there a deletion that has to travel. `deletedAt` rides the wire as an
  optional field, so `SYNC_PROTOCOL_VERSION` did not move.
- **Every query that means "the diary" must exclude the trash**: `useEntries`,
  `entriesInRange` (and therefore every report), `findEntryByDate` (so a
  trashed date is free to be written again), and `exportAll`. The backup keeps
  them, deliberately — a backup is a copy of the state, trash included.
- **Restoring re-checks one page per project per day.** Nothing stopped that
  date being written again while the page sat in the trash, so a clash is
  refused with a reason rather than silently making two pages for one day.
- The trash is the one screen with selection always on, and the one place in
  the app with a confirmation dialog — emptying it is the only action that
  cannot be undone.

## The typeface is a setting, and it reaches the documents

`src/fonts.ts` is the catalogue: seven faces, five Hebrew and two Arabic, all
carrying Latin. The choice is **per language** — a Hebrew face says nothing
about how Arabic should look — and it is stored in localStorage under
`yoman-font-<lang>`, applied in the pre-paint script in `index.html` beside the
theme and the direction.

- **It reaches everything because it is one custom property.** `--font` was
  already what every rule read; the setting writes it onto `<html>`. There is no
  list of places to remember to update.
- **`--doc-font` is a second property, and the difference is load-bearing.** The
  A4 preview reads it rather than `--font`: on the system font the screen uses
  the device's face while the document still prints Heebo, and a preview showing
  the screen's font would be lying about the PDF.
- **The PDF embeds, the Word file names.** Each family is fetched twice by
  `npm run fonts` — woff2 for the interface, TrueType for `pdf-lib`, which
  cannot read woff2. The TTFs are fetched at export time rather than imported as
  bytes, so a phone never downloads the faces nobody picked.
- **Word keeps saying Arial unless a face was chosen.** A .docx carries a name
  and Word substitutes silently; Arial is the one face every Word install has.
  Naming an unchosen Heebo would have most machines quietly replace it.

## ספקים וקבלנים — the address book

`ContactsScreen` is the one screen that is not the printed form. Six columns —
number · שם קבלן או ספק · תחום התעסקות · מספר טלפון · באיזה פרויקט עבד איתי ·
הערות כלליות — typed into directly, because the value of the list is that adding
a number takes a moment while the man is still standing there.

- **One markup, two shapes.** Below 860px each line folds into a card whose
  fields carry their own labels through `content: attr(data-label)`; above it the
  same divs lock into `--ctable-cols`. A six-column table at 390px is not a table.
  On the phone the four short fields pair two to a line — stacked, one supplier
  filled the screen and thirty of them could not be scanned at all.
- **Every keystroke saves itself** after 500ms, and immediately on blur, on
  leaving the screen and on `visibilitychange` — the last because iOS can end the
  page when the app is backgrounded without another event. There is no save button.
- **A pending edit outranks the stored row** while it is in flight, and is dropped
  only after the write and only if no newer keystroke replaced it. Without that
  test the live query hands back the row as saved and eats the last letter typed.
- **It is reachable with no project** (`PROJECTLESS` in `App.tsx`), like Settings:
  the book belongs to the person, not to a site.
- **תחום התעסקות suggests the trades the diary already learned.** `usePresets().trade` is
  fed by every contractor row ever saved, and the trades on a site are the same handful
  over and over — asking for them again here would be asking twice. A `<datalist>`, so a
  trade the diary has not seen is still typeable.
- **The list goes out as CSV and comes back as CSV** (`src/lib/contactsCsv.ts`), because
  the answer to "send me your supplier list" is a file the other person can open. Two
  details are the whole round trip: a **UTF-8 BOM**, without which Excel reads the file in
  the local codepage and every Hebrew name arrives as mojibake, and **columns matched by
  their heading** in any of the three languages, with position only as the fallback — so a
  list exported in Hebrew imports into an app running in English, and a hand-made file
  carrying just a name and a number works too.
- **The printed list is the app's other document.** `src/pdf/contactsPage.ts` borrows the
  header band, the footer and the palette from the diary pages, so a company's paperwork
  looks like one set. It measures every row before drawing any: a note wraps to three
  lines and is clipped there, so neither the row heights nor the page count printed in
  each header is known until the whole list has been wrapped. Measure, paginate, draw.
- Deleting offers an undo, and `restoreContact` drops the tombstone with it — the
  same rule, for the same reason, as `restoreEntry`.
- **Contacts are in the backup and in the sync, and neither version moved.**
  `BackupFile.contacts` and `SyncManifest.contacts` are optional fields: bumping
  `BACKUP_VERSION` would make older builds *refuse* the file, and bumping
  `SYNC_PROTOCOL_VERSION` would stop two devices syncing the diary itself until
  both were updated. A phone number list is not worth either.
- Names and numbers are **never logged** — counts only. This is somebody's
  contacts, and the log file gets sent to other people.

## Spreadsheet export

`src/xlsx/` writes a real .xlsx by hand, for reasons that matter (RTL sheet flag,
quantities as numbers rather than free text) — see `src/xlsx/CLAUDE.md`.

## Handing the whole job over

`src/lib/exportAll.ts` answers the request the range report and the backup both miss:
everything, as files a person can open, without picking dates or exporting a page at a
time. One zip — a folder per project, a PDF per day inside it, and the workbook beside
them so the totals are there without opening thirty documents. It is the one export that
runs long enough to need a progress callback (`ExportAllProgress`), because it builds a
PDF per diary page. The backup JSON is a different thing and stays a different thing: it
moves the *data* to another device, and only `restoreFromJson` reads it.

## Backups that do not depend on anyone remembering

`src/lib/autoBackup.ts`. The manual export in Settings was always there and it
did not save this diary: the files on disk were two days apart and then nothing
for a fortnight. Anything that depends on discipline produces that.

- **Each platform writes where it can.** The Mac gets a dated file in
  `Documents/יומן עבודה - גיבויים` through `yoman:autoBackup`, an IPC handler
  that takes bytes and a name and chooses the folder itself — the renderer
  cannot influence where it lands, the same bargain the save dialog makes. The
  phone writes into its own Documents directory, which is in the device's iCloud
  backup; `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` are
  what make that folder visible in Files. A browser can write nothing silently
  and says so instead of pretending.
- **It runs on launch, not on a timer**, at most twice a day and four seconds
  in. A diary is edited in bursts and closed; a clock ticking in a hidden tab
  covers that worse and costs a phone battery.
- **It never throws.** A failed backup must not take a save or a launch with it.
- **Settings shows the age of the last one**, amber past three days. A backup
  nobody can see the age of is one nobody notices has stopped.

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

`log.ts` reaches the `logs` table through a dynamic `import('../db')`, and never a static
one. That is deliberate: it keeps `log.ts` safe to import from anywhere, including modules
the database itself depends on, with no cycle at runtime — which is precisely what lets
`db.ts` import the logger as a value.

**A line that says something happened must not be written when it did not.** The log
exists to answer "I pressed export and nothing happened", so `saved via desktop dialog
{saved:false}` was worse than no line at all: it read as success at a glance and only the
trailing JSON disagreed. An outcome belongs in the message, not in a field beside it.

**What is not written down did not happen, as far as anyone reading this file can tell.**
The gaps are as load-bearing as the rules: the database wrote nothing for its first week,
so five days of real use came to eleven lines and a page vanishing overnight had nothing
to point at; the Mac answered every sync without recording one; deleting a page from the
editor left no trace while deleting the same page from the list did. When adding a path
that can lose work, add the line with it.

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
- `requestPersistentStorage()` runs at start-up (`src/lib/native.ts`) and matters most for
  the home-screen web app: iOS can clear a web app's storage after a stretch of not being
  opened, and the diary is the only copy. Granted persistence takes it out of that path.
  Settings shows the answer, so "will it lose my pages" has something to point at.

## Local-network sync

Two devices each hold a full copy of the diary; syncing is a **merge**, not a client
talking to a server. The whole thing lives in `src/sync/` (with the Mac’s half in
`electron/sync-server.js`), and so does its guidance: **`src/sync/CLAUDE.md`** covers the
protocol, the chunking, the four performance traps, and the rules — tombstones, local
numeric ids, last-write-wins — that are easy to undo by accident. Read it before
touching either file.

## The day's page folds

Ten sections, one open at a time. The form the app is built around had every one
of them expanded at once, which on a phone is four screens of scrolling to reach
the photographs — and the diary is filled in standing up, outdoors, a section at
a time.

- **A folded section says what is in it.** `Card`'s `summary` is the whole idea:
  `חשמלאי, אינסטלטור · 10 עובדים` on one line costs nothing to read past, where a
  fold that showed only the section's name would make the page shorter and less
  useful at once. The body is not rendered while it is closed.
- **The rail belongs to the action bar, not to the screen.** `PageActions.sections`
  publishes the ten as chips with a done dot, and `PageActionsBar` draws them
  inside `.chrome` — there is room for exactly one sticky element here, and a
  third bar sticking at `top: 0` on its own lands on top of the other two the
  moment the page scrolls. `.card` carries `scroll-margin-top` so a section
  opened from the rail scrolls clear of the bars rather than under them.
- **The page opens where the day was left off** — `firstUnfinished`, the first
  section with nothing written in it yet.
- **A count is a stepper.** `ColumnDef.stepper` puts a minus and a plus either
  side of the field in the crew tables. The field stays a field, because a crew
  of `3 + 1` is a thing people write; the buttons move the number the cell starts
  with and leave whatever followed it. Summoning the number keyboard to change a
  2 into a 3 was the most-repeated action in the app.
- **"כמו ביום הקודם" fills a table from the previous page** (`previousEntry` —
  the previous *page*, not literally yesterday, because Friday is followed by
  Sunday). Rows are copied with fresh ids, so editing today cannot reach back
  into yesterday.

The same vocabulary carries the other three screens: the diary list leads with a
filled card for today when the day has no page yet and offers
`הכל / טיוטה / פעיל / עם תמונות` as counted chips; the report screen names the
ranges people actually ask for and says how long the document will be before it
is made; the supplier list filters by the trades it actually contains and gives
calling — the reason it exists on a phone — the one colour in the row.

## Settings that belong to the device

Three of them now, and the keyboard shortcuts below are the third.

- **What each swipe on a diary row does** (`src/lib/swipeActions.ts`). The
  gestures and the actions behind them all existed; what was fixed and is now a
  choice is which gesture reaches which action — and `ללא` is a first-class
  answer, because a swipe that does nothing is the right setting for anyone who
  has deleted a day by accident. Stored per edge (`start`/`end`), never per
  side, so the choice survives switching the app to English.
- **The daily reminder** (`src/lib/reminder.ts`). A *local* notification, so it
  fires with no signal and no server — which is also why it exists only in the
  installed app; a browser tab cannot schedule anything for tomorrow evening,
  and the card says so rather than offering a switch that quietly does nothing.
  It is a fortnight of individual notifications rather than one repeating alarm,
  and that is what lets today's be dropped once the day has been written: a
  repeating alarm cannot skip an occurrence. The window is laid again on launch
  and when the app is put away, which is the moment the day's page has usually
  just been finished.

## A screen's actions live at the top

`src/hooks/editorActionsContext.ts` is how a screen puts its own actions in the
app bar. It began as undo/redo and now carries the rest: a screen publishes a
`PageActions` — one `primary` and grouped `groups` — and `PageActionsBar`
renders it. Screens that publish nothing get no bar, so the diary list and
settings are untouched.

- **The editor's seven buttons were at the bottom of the form**, wrapped over
  three rows, under two crew tables and a photo grid. The button pressed most
  often was a screen of scrolling from where you were typing. Same for the range
  report, whose whole purpose was the button underneath it.
- **One action is a button, the rest are a menu.** Six filled pills beside the
  primary would be the bottom row again, moved up.
- **`.chrome` wraps the app bar and the action bar in ONE sticky element.**
  Sticking them separately at `top: 0` makes them pile on top of each other the
  moment the page scrolls.
- **The menu is a portal on `document.body`, and it has to be.** The bar is
  frosted, and in Chrome anything with `backdrop-filter` turns its whole subtree
  into a backdrop root: an opaque white card inside it renders *see-through*.
  Moving the blur to a pseudo-element does not help — the pseudo is still in the
  subtree. Out of the subtree is the only fix.
- **The publishing effect must depend on primitives, never on the handlers.**
  `saveNow`, `doExport` and friends are rebuilt every render, so an effect
  listing them — or listing nothing — publishes a new object every render, sets
  state in the parent, and re-renders without end. The handlers go in a ref;
  the effect depends on `t`, the busy flag and the ids. In `EntryEditor` that
  ref is filled **during render** rather than in an effect, because the hook has
  to sit above the loading guard while the functions are defined below it.

## Keyboard shortcuts press the buttons that are already there

`src/lib/shortcuts.ts` is the catalogue, `src/hooks/useShortcuts.ts` is the one
listener, and `ShortcutsCard` in Settings is where they are changed. The Mac app
had no keyboard at all: every export meant reaching for the mouse, on the one
platform where that is the slower way to do anything.

- **A shortcut can do nothing a button cannot.** Every screen already publishes
  what it can do (`editorActionsContext`), so a shortcut names a `PageAction` by
  its id and presses it — through the same `disabled`/`busy` flags the button is
  drawn with. There is no second implementation of saving or exporting to keep
  in step with the first, and a shortcut on a screen that does not offer the
  action does nothing, which is the answer the missing button already gives.
  This is the same bargain `swipeActions.ts` makes with the gestures.
- **Bindings are read from `event.code`, never `event.key`.** `event.key` is the
  letter the *layout* produces: on the Hebrew keyboard this diary is written on,
  the S key sends `ד` and ⌘S never arrives. `event.code` is the physical key —
  `KeyS` whatever the input source is. The letters are chosen from the English
  words for the same reason: the binding is a key, not a word, and the same key
  has to make sense to a diary kept in three languages.
- **A letter typed into a field is a letter.** Shortcuts with no modifier never
  fire while the caret is in one. Two modified ones stand down there as well and
  say so themselves (`inField: 'skip'`): ⌘Z belongs to the field's own undo
  stack — taking it over throws away a sentence when the user meant the last
  word — and ⌘⌫ is "delete to the start of the line" on every Mac, where here it
  would delete the day's page. ⌘S is the opposite case and must reach the app
  from inside the description, which is where you are when you want it.
- **The key is printed left to right, and the markup has to say so.** `⌘ ⇧ Z`
  set loose in a Hebrew row comes out `Z ⇧ ⌘` — the same reordering the PDF's
  dates are guarded against, one layer up. Every place a combination is drawn
  carries `dir="ltr"`.
- **The parsed bindings are cached in the module.** Every keystroke anywhere in
  the app asks which shortcut it is, and answering walks the whole catalogue —
  so reading the stored JSON per definition meant eighteen `localStorage` reads
  for each letter typed into a day's description.
- **The menu prints the key beside the action.** Nobody opens a settings screen
  to learn that P makes a PDF; they see it every time they reach for the menu,
  and eventually stop reaching for it. The settings card is for changing them,
  not for learning them.
- Recording refuses a combination that is taken, **by name**, and `Backspace`
  clears one — `ללא` is a first-class answer here for the reason it is for a
  swipe. While a row is listening, a module flag stops the key being *used* at
  the moment it is being stored, or pressing ⌘S to bind it would save the page
  underneath and pressing 1 would walk off the screen.

`EntryEditor` used to carry its own ⌘Z listener. It is in the catalogue now, so
it is listed with the rest and can be rebound; the rule that came with it did
not get lost in the move.

## The look: a scale, a grid, and one family of icons

Three things in `global.css` are shared by every screen, and each was added
because its absence was what made the app look homemade.

- **The interface wears the document's colours, and this is deliberate.**
  `--accent` is `#0f2d4a` — the exact value `docTheme.ts` prints the header band
  in — and the amber beside it is that theme's `accent` to the digit. It was
  `#007aff`, stock iOS blue, a colour appearing nowhere in the thing the app
  makes; the export button is now the colour of the page that comes out of it.
  **Three tokens, and the distinction matters**: `--accent` is text, icons,
  borders and focus rings and must contrast with `--bg`; `--accent-fill` is a
  filled surface; `--accent-ink` is what sits on that fill. A navy dark enough
  to read as text on paper is not a fill you can put white on at night, which is
  why the dark and black themes lift `--accent` and keep `--accent-fill` deep.
  White on the old blue was 4.02:1 — a fail at AA on the app's most important
  button; the three themes now measure 14.05, 5.54 and 6.27:1. **Only one action
  on a screen is filled.** `.btn--brand` is outlined rather than a second filled
  navy: the PDF is the deliverable and the Word file is the editable copy, and
  two filled buttons side by side each claim to be the main thing to do.
- **A counted noun goes through a function that handles one of it.** "1 ימים"
  is what every counter said before, in all three languages. Hebrew needs the
  singular and has a real dual for days (`יומיים`); **Arabic counts in four
  forms** — one, dual, a paucal for three to ten, and the accusative singular
  from eleven up — so `${n} أيام` is right only between three and ten.

- **The type scale is nine steps, `--fs-2xs` … `--fs-3xl`, and there are no raw
  sizes.** Before it there were seventeen, in three units, most within half a
  pixel of a neighbour — 0.85, 0.84, 0.82, 0.8 — so nothing lined up and no size
  meant anything. Pick a step; if none fits, the design is wrong, not the scale.
  **`.sheet__*` is exempt and stays in px**: those are the PDF's `METRICS` at
  96dpi, and a preview on the interface's scale is a preview that lies.
- **Spacing is `--s1` … `--s12` on a 4px grid**, for the same reason.
- **`.main` is 860px.** Not a window — a measure. It is the width of an A4 sheet
  at 96dpi plus its margins, so the preview fits the same column as everything
  else instead of being a special case. Fields cap tighter still: 46ch, 18ch for
  a date, 12ch for a number. A form stretched across a Mac is the clearest sign
  a layout was written for a phone and left to fend for itself.
- **`src/components/Icon.tsx` is the only source of icons, and emoji are not
  icons.** Every platform draws them differently, they carry their own colours so
  they cannot follow the theme, and a row of them reads as decoration. If a new
  control needs a mark, add a path to `PATHS` — 24×24, 1.8 stroke, round caps,
  `currentColor`. Shapes are chosen for silhouette because most are drawn at
  14–17px: a spanner for plant rather than an excavator, sliders for settings
  rather than a cog.
- **`svg { vertical-align: middle }` at the root is load-bearing.** An SVG is a
  replaced inline element, so it sits on the baseline: a 14px icon beside 13px
  text rides two pixels high, everywhere, until this rule.
- **Every icon carries `.icon--<name>`,** which is how one rule mirrors `chevron`
  in a right-to-left layout without each caller having to know it points the way
  the text runs. `icon--back` is its opposite, whichever way round that is.
- **Strings hold words, not glyphs.** Eight labels used to carry an emoji baked
  into all three translations, which meant a mark nobody could restyle and three
  copies of it to keep in step.
- **A control repeated on every row cannot also be emphasised on every row.**
  Export in a diary row and delete in a table row are quiet by default and take
  colour only when reached for; they keep the full `--tap` target. The status in
  a list is a dot on the meta line rather than a pill, because thirty coloured
  pills stop being information and become the pattern the eye follows instead of
  the descriptions.

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
- **Save or share is the caller's choice, and share falls back to save.** `deliverBlob`
  takes `'save' | 'share'`; when no sheet can be opened the file still lands where "save"
  would have put it, so an export is never simply lost.
- **Escape closes the innermost layer.** `useEscape` keeps a stack rather than letting
  every open layer hear the key, so a modal over a preview closes the modal and leaves the
  preview for the second press. Pass `null` to stand down without unmounting — which is
  how selection mode registers only while something is selected.
- **An export says whether the file actually reached the user.** `saveBlob` returns a
  boolean and every exporter returns `ExportResult` — the file name, or `null` for a
  cancelled dialog or a device with nowhere to put it. Cancelling is not a failure, so
  nothing is thrown and the caller stays quiet; what it must not do is announce a file
  that does not exist, which is what `toast.show(t.fileCreated(name))` unconditionally
  did. `saveAs` in a web view does nothing at all, so on the native shell that path
  reports failure rather than pretending to be a download.

## Deliberate deviations from the printed form

The original prints `חתמת מנ"ע` (missing yod); the app uses the correct `חתימת מנ"ע`.
Everything else follows the form as drawn.
