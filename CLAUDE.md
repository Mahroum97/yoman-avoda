# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An offline-first work diary for construction sites (יומן עבודה · سجل العمل · Work Diary).
The user fills in a day's page and exports a **designed PDF or Word document** based on
the printed A4 form in `יומן עבודה לעבודות בנייה.pdf` — that PDF is the origin of the
layout, and fidelity to its structure is the point of the project.

It ships two ways from one codebase: a **PWA** (installable on a phone, works with no
signal) and a **macOS app** (Electron, `npm run app:build`). React + TypeScript + Vite,
IndexedDB via Dexie, `pdf-lib` and `docx` for the documents. No server, no accounts.

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
```

`עדכון.command` at the repo root is the user-facing updater: double-clicking it installs,
rebuilds the site and rebuilds the Mac app, reporting progress in Hebrew.

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
(צוות הנהלה, קבלן, ציוד) · תיאור העבודה שבוצעה + פרטי יציקה · הערות המפקח + חתימות.

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
