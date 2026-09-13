# Desktop document workspace — 13 September 2026

The desktop diary now opens the approved three-column workspace: dated pages at
the writing-direction start, the actual A4 document in the centre, and a document
inspector with PDF, Word and image delivery at the end. Application destinations
are a horizontal row below the title bar; New sits at its far end. Below 1100px,
the phone retains its five bottom tabs with New in the centre.

The earlier implementation applied card styling and an editor preview, but left
the desktop's default diary as the old list. This change connects the approved
layout to real records and operations. All pages still opens the searchable,
sortable list with selection and trash controls. Editing retains the queued
autosave and shared live A4 preview.

The interface uses neutral surfaces and state colours. The A4 preview preserves
the selected report palette and printed form; it is the existing `SheetPreview`,
not a separate rendering of the mockup. iCloud is not represented as available;
the application's current sync transport remains LAN sync.

## Safeguards completed during implementation

- The default view finds the most recent live page even if it is in an older month.
- Month queries use the project/date index and reject results for a previous month.
- Page bookmarks resolve their own project. Related report, list and new-page
  navigation continues in that project.
- Exports flush pending edits, re-read the current page and owner in a consistent
  transaction, and block unresolved same-date, cross-date and deletion conflicts.
- Export buttons share a synchronous in-flight guard. Cancelling a save does not
  announce a file. Word now supports the same native share delivery as PDF/image.
- Existing legacy pages without causal metadata use their original validated
  revision when editing begins. A null expectation previously created a false
  conflict between the page's earlier and edited contents; reopening could show
  the empty earlier copy although the edited data remained in the other branch.
  The contractor regression now requires all three rows and no false branches
  after navigation, flushing and reload; it passed five fresh runs.
- The Mac title remains visible, Settings stays at the physical upper-right, and
  the native traffic-light area remains clear in both writing directions.

## Verification

Sol subagents using xhigh reasoning executed the following checks against fresh,
synthetic storage. No tests ran against the installed diary's data.

| Check | Result |
| --- | --- |
| `check-desktop-document.mjs` | Passed: 1099/1100 breakpoints, 1180/1320 widths, English/Hebrew/Arabic, month selection, owner routing, PDF/Word/JPEG bytes, share/cancel, conflict blocking |
| `check-desktop-electron.mjs` | Passed: real Electron main/preload/renderer, project creation/edit, new/save/reopen, contacts autosave, settings/theme/language, report navigation, keyboard/menu, PDF writing and backup |
| `check-cards-workspace.mjs` | Passed: horizontal destinations, live A4 editor/dialog, Mac title-bar clearance, 390px phone controls |
| `check-empty-navigation.mjs` | Passed |
| `check-mobile-taps.mjs` | Passed |
| `check-route-errors.mjs` | Passed |
| `check-mutation-failures.mjs` | Passed |
| `check-report-ui.mjs` | Passed |
| `check-quantity-ui.mjs` | Passed |
| `check-storage.mjs` | Passed |
| `check-causal-sync.mjs` | Passed |
| `check-causal-conflict-ui.mjs` | Passed; list assertions use the explicit desktop list route |

`npm run typecheck`, `npm run lint`, `npm run build` and `npm run sample` passed.
The rendered Hebrew PDF was visually checked: correct date digit order, no missing
bottom blocks, and both signature boxes present. Desktop screenshots were reviewed
for overlap, clipping, writing direction and horizontal overflow.

The Electron harness runs the real application with disposable user data and
Documents directories. Its test-only bootstrap prevents a LAN listener and supplies
deterministic save-dialog outcomes; actual exported bytes and backup files are
written through the production IPC handlers. Native share-menu choices, a new
physical iPhone installation, and large-photo transfers between physical devices
were not exercised in this layout pass.

Run browser checks against Vite, with `YOMAN_BASE_URL` if not using port 5173.
Set `YOMAN_PLAYWRIGHT_PATH` to an installed Playwright module if it is external to
the repository. Native QA uses the same variables and `node
scripts/check-desktop-electron.mjs`; its default server is port 5182.

Local evidence: `tmp/desktop-document-he-dark-viewport.png`,
`tmp/desktop-document-default-1180.png`, and
`tmp/desktop-electron-qa/native-run.json` with `04-final-workspace.png`.
