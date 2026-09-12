/**
 * The daily diary page editor. Sections follow the printed form top to bottom
 * so that a user who knows the paper knows this screen.
 *
 * Saving is explicit *and* automatic: edits are flushed to IndexedDB ~1.2s
 * after typing stops, because a phone on a building site gets locked, dropped
 * and backgrounded mid-sentence.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiaryEntry, Project } from '../types';
import {
  blankEntry,
  db,
  deleteEntry,
  EntryDateConflictError,
  EntryUnavailableError,
  previousEntry,
  saveEntryChecked,
  statusFor,
  type SavedEntryResult,
} from '../db';
import { formatDdMmYyyy, formatLongDate, isoDate } from '../lib/dates';
import { formatBytes } from '../lib/images';
import { photoSize } from '../lib/photoData';
import { addExact, parseWorkerCount } from '../lib/exactQuantity';
import { usePresets } from '../hooks/useData';
import { uid } from '../lib/id';
import { useCompanyLogo } from '../hooks/useBranding';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { navigate } from '../hooks/useRoute';
import { Card, Combobox, EmptyState, Field, StatusChip } from '../components/ui';
import { Icon } from '../components/Icon';
import { RowsEditor, type ColumnDef } from '../components/RowsEditor';
import { SignaturePad } from '../components/SignaturePad';
import { useSavedSignatures } from '../hooks/useSignatures';
import { PhotoGrid } from '../components/PhotoGrid';
import { ContractorRowsEditor } from '../components/ContractorRowsEditor';
import { QuantityLedger } from '../components/QuantityLedger';
import { canShareFiles } from '../lib/save';
import { useUndoable } from '../hooks/useUndoable';
import { useEditorActions } from '../hooks/editorActionsContext';
import { registerPendingWriteFlusher } from '../lib/pendingWrites';
import { logger } from '../lib/log';
import { CardsEditorLayout } from '../components/CardsWorkspace';

const AUTOSAVE_MS = 1200;
const log = logger('entry-editor');

/*
 * One chain survives editor unmounts. Leaving a page queues its last revision;
 * reopening it must wait for that write before reading, or two component-local
 * queues can race and the older screen can overwrite the newly reopened one.
 */
let editorSaveTail: Promise<void> = Promise.resolve();

/** The section a page should open on: the first one with nothing written in it. */
function firstUnfinished(entry: DiaryEntry): string {
  if (!entry.weather.trim()) return 'date';
  if (entry.contractors.length === 0) return 'contractors';
  if (!entry.workDescription.trim()) return 'work';
  if (entry.photos.length === 0) return 'photos';
  if (!entry.managerSignature?.trim()) return 'signatures';
  return 'date';
}

interface Handlers {
  saveNow: () => Promise<void>;
  doExport: (format: 'pdf' | 'word' | 'image') => Promise<void>;
  doShare: () => Promise<void>;
  toggleSigned: () => Promise<void>;
  remove: () => Promise<void>;
}

export function EntryEditor({
  entryId,
  project,
  initialDate,
}: {
  entryId?: number;
  project: Project;
  initialDate?: string;
}) {
  const toast = useToast();
  const { t } = useLanguage();
  const presets = usePresets();
  const logoDataUrl = useCompanyLogo();
  const savedSignatures = useSavedSignatures();

  /*
   * The page being edited, with its history. `commit` records an undoable step;
   * `amend` moves the value without one — see useUndoable.
   *
   * Destructured rather than used through the object: the object's identity
   * changes with every edit while these functions are stable, so depending on
   * it would re-run the load effect on each keystroke and pull the page back
   * from the database mid-sentence.
   */
  const { value: entry, commit, amend, reset, undo, redo, canUndo, canRedo } =
    useUndoable<DiaryEntry>();
  const [loading, setLoading] = useState(true);
  const [loadUnavailable, setLoadUnavailable] = useState(false);
  const { publish, publishPage } = useEditorActions();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dateConflict, setDateConflict] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  /*
   * Which section is unfolded. One at a time, deliberately: with ten of them
   * open the page was four screens long, and the point of folding them is that
   * the whole day fits on one.
   */
  const [openSection, setOpenSection] = useState<string>('');
  const [exporting, setExporting] = useState<'pdf' | 'word' | 'share' | 'image' | null>(null);
  const [explicitBusy, setExplicitBusy] = useState<string | null>(null);
  // Offered only where a share sheet exists; on a plain desktop browser it
  // would do nothing the export buttons do not already do.
  const canShare = useMemo(() => canShareFiles(), []);
  const latest = useRef<DiaryEntry | null>(null);
  /*
   * Saves are ordered, and dirtiness names the exact revision it belongs to.
   * A boolean alone lets an older save finish after a newer keystroke and mark
   * that newer text clean; independent promises can also write stale snapshots
   * out of order. These refs make the last requested revision the last write.
   */
  const generation = useRef(0);
  const revision = useRef(0);
  const dirtyRevision = useRef<{
    uid: string;
    generation: number;
    revision: number;
  } | null>(null);
  const persistedIds = useRef(new Map<string, number>());
  // Read only when a queued write begins, then advanced only by that successful
  // write. This detects a sync/other-window revision that arrived behind the
  // open editor without mistaking our own queued revisions for conflicts.
  const expectedUpdatedAt = useRef(new Map<string, number | null>());
  const expectedSyncRevision = useRef(new Map<string, string | null>());
  /** Old editor identity -> the deterministic branch now holding its draft. */
  const branchAliases = useRef(new Map<string, SavedEntryResult>());
  const discarded = useRef(new Set<string>());
  const mounted = useRef(false);
  const explicitOperation = useRef<string | null>(null);
  const saveProblem = useRef<HTMLDivElement>(null);
  const pendingFlush = useRef<Promise<void> | null>(null);

  const resolveBranch = useCallback((uid: string): SavedEntryResult | undefined => {
    const seen = new Set<string>();
    let current = uid;
    let resolved: SavedEntryResult | undefined;
    while (!seen.has(current)) {
      seen.add(current);
      const next = branchAliases.current.get(current);
      if (!next) break;
      resolved = next;
      if (next.uid === current) break;
      current = next.uid;
    }
    return resolved;
  }, []);

  const rememberBranch = useCallback((fromUid: string, saved: SavedEntryResult) => {
    branchAliases.current.set(fromUid, saved);
    branchAliases.current.set(saved.uid, saved);
    persistedIds.current.set(fromUid, saved.id);
    persistedIds.current.set(saved.uid, saved.id);
    expectedUpdatedAt.current.set(fromUid, saved.updatedAt);
    expectedUpdatedAt.current.set(saved.uid, saved.updatedAt);
    expectedSyncRevision.current.set(fromUid, saved.syncRevision);
    expectedSyncRevision.current.set(saved.uid, saved.syncRevision);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Load once; afterwards this component owns the draft in local state.
  useEffect(() => {
    let cancelled = false;
    const thisGeneration = ++generation.current;
    setLoading(true);
    setLoadUnavailable(false);
    (async () => {
      await editorSaveTail;
      if (cancelled || generation.current !== thisGeneration) return;
      const fresh = () => blankEntry(project.id!, initialDate ?? isoDate(), project.uid);
      const loaded = entryId === undefined ? fresh() : await db.entries.get(entryId);
      if (cancelled || generation.current !== thisGeneration) return;
      if (
        !loaded ||
        loaded.deletedAt !== undefined ||
        loaded.projectId !== project.id ||
        (loaded.projectUid && loaded.projectUid !== project.uid)
      ) {
        // A stale/purged route is never a request to create a replacement day.
        // The shell normally catches this first; this closes the race where the
        // record disappears after route resolution but before this read.
        latest.current = null;
        dirtyRevision.current = null;
        setDirty(false);
        setLoadUnavailable(true);
        setLoading(false);
        return;
      }
      // A different page means a different history; nothing from the last one
      // should be reachable by pressing undo here.
      const page = loaded;
      branchAliases.current.clear();
      latest.current = page;
      if (page.id !== undefined) persistedIds.current.set(page.uid, page.id);
      expectedUpdatedAt.current.set(page.uid, page.id === undefined ? null : page.updatedAt);
      expectedSyncRevision.current.set(page.uid, page.syncRevision ?? null);
      dirtyRevision.current = null;
      setDirty(false);
      setDateConflict(false);
      setSaveFailed(false);
      reset(page);
      /*
       * Opens where the day was left off: the first section with nothing in it
       * yet. A new page opens on the date, and a page that only wants its
       * photographs adding opens on those — rather than everything folded and
       * a tap needed before anything can be typed.
       */
      setOpenSection(firstUnfinished(page));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId, project.id, project.uid, initialDate, reset]);

  if (!loading && !loadUnavailable) latest.current = entry;

  const persist = useCallback(
    (
      candidate: DiaryEntry,
      requestGeneration = generation.current,
    ): Promise<boolean> => {
      const marker = dirtyRevision.current;
      const candidateAtCall = resolveBranch(candidate.uid)?.uid ?? candidate.uid;
      const markerAtCall = marker
        ? resolveBranch(marker.uid)?.uid ?? marker.uid
        : undefined;
      const requestRevision =
        markerAtCall === candidateAtCall && marker?.generation === requestGeneration
          ? marker.revision
          : revision.current;

      if (
        discarded.current.has(candidate.uid) ||
        discarded.current.has(candidateAtCall)
      ) {
        return Promise.resolve(false);
      }
      if (mounted.current && generation.current === requestGeneration) {
        setDateConflict(false);
        setSaving(true);
      }

      const run = editorSaveTail.then(async () => {
        const prior = resolveBranch(candidate.uid);
        const requestUid = prior?.uid ?? candidate.uid;
        if (discarded.current.has(candidate.uid) || discarded.current.has(requestUid)) {
          return false;
        }

        // A prior queued save may have acquired an id or deterministically
        // moved this draft onto a conflict-branch uid. Rebase this snapshot at
        // execution time; saving its captured old identity would overwrite the
        // branch that the earlier save deliberately preserved.
        const knownId = prior?.id ?? persistedIds.current.get(requestUid) ?? candidate.id;
        const toSave: DiaryEntry = {
          ...candidate,
          ...(knownId === undefined ? {} : { id: knownId }),
          uid: requestUid,
          ...(prior
            ? {
                syncRevision: prior.syncRevision,
                syncConflict: prior.syncConflict,
                syncConflictKind: prior.syncConflictKind,
                syncConflictGroup: prior.syncConflictGroup,
                syncConflictRoot: prior.syncConflictRoot,
              }
            : {}),
        };
        const expectedAt = expectedUpdatedAt.current.has(requestUid)
          ? expectedUpdatedAt.current.get(requestUid)!
          : prior?.updatedAt ?? null;
        const expectedRevision = expectedSyncRevision.current.has(requestUid)
          ? expectedSyncRevision.current.get(requestUid)!
          : prior?.syncRevision ?? candidate.syncRevision ?? null;

        try {
          const saved = await saveEntryChecked(
            toSave,
            expectedAt,
            expectedRevision,
          );
          rememberBranch(candidate.uid, saved);
          rememberBranch(requestUid, saved);
          if (discarded.current.has(candidate.uid) || discarded.current.has(requestUid)) {
            discarded.current.add(saved.uid);
          }

          const currentMarker = dirtyRevision.current;
          const currentMarkerUid = currentMarker
            ? resolveBranch(currentMarker.uid)?.uid ?? currentMarker.uid
            : undefined;
          const isCurrentRevision =
            currentMarker === null
              ? generation.current === requestGeneration && revision.current === requestRevision
              : currentMarkerUid === saved.uid &&
                currentMarker.generation === requestGeneration &&
                currentMarker.revision === requestRevision;
          if (currentMarker && currentMarkerUid === saved.uid && !isCurrentRevision) {
            // A newer keystroke still belongs to this logical draft. Move its
            // marker with the branch so the flush loop writes it next.
            dirtyRevision.current = { ...currentMarker, uid: saved.uid };
          }
          const latestUid = latest.current
            ? resolveBranch(latest.current.uid)?.uid ?? latest.current.uid
            : undefined;
          const ownsScreen =
            mounted.current &&
            generation.current === requestGeneration &&
            latestUid === saved.uid &&
            !discarded.current.has(candidate.uid) &&
            !discarded.current.has(saved.uid);

          // Revision ownership survives unmount. Route-exit flushing has to
          // retire the exact marker it wrote even though there is no mounted
          // component left to update; otherwise its flush loop writes the same
          // snapshot forever and races a newly reopened editor.
          if (isCurrentRevision) dirtyRevision.current = null;

          if (ownsScreen) {
            const settled = statusFor(candidate);
            // Identity and causal metadata are bookkeeping and always follow
            // the canonical result. Status follows only the exact revision.
            const needsStatus = isCurrentRevision && settled !== latest.current?.status;
            const canonical = {
              id: saved.id,
              uid: saved.uid,
              updatedAt: saved.updatedAt,
              syncRevision: saved.syncRevision,
              syncConflict: saved.syncConflict,
              syncConflictKind: saved.syncConflictKind,
              syncConflictGroup: saved.syncConflictGroup,
              syncConflictRoot: saved.syncConflictRoot,
            };
            latest.current = {
              ...latest.current!,
              ...canonical,
              ...(needsStatus ? { status: settled } : {}),
            };
            amend((current) => {
              const currentUid = resolveBranch(current.uid)?.uid ?? current.uid;
              return currentUid === saved.uid
                ? { ...current, ...canonical, ...(needsStatus ? { status: settled } : {}) }
                : current;
            });
            if (
              candidate.id === undefined ||
              knownId !== saved.id ||
              requestUid !== saved.uid
            ) {
              // First save or deterministic branch reassignment. replaceState
              // keeps the editor mounted, including any newer queued revision.
              window.history.replaceState(null, '', `#/entry/${saved.id}`);
            }
            if (isCurrentRevision) {
              setDirty(false);
              setSaveFailed(false);
            }
          }
          return true;
        } catch (error) {
          if (error instanceof EntryDateConflictError) {
            const currentMarker = dirtyRevision.current;
            const currentMarkerUid = currentMarker
              ? resolveBranch(currentMarker.uid)?.uid ?? currentMarker.uid
              : undefined;
            const requestIsCurrent =
              currentMarker === null
                ? generation.current === requestGeneration && revision.current === requestRevision
                : currentMarkerUid === requestUid &&
                  currentMarker.generation === requestGeneration &&
                  currentMarker.revision === requestRevision;
            const latestUid = latest.current
              ? resolveBranch(latest.current.uid)?.uid ?? latest.current.uid
              : undefined;
            if (
              mounted.current &&
              generation.current === requestGeneration &&
              latestUid === requestUid &&
              requestIsCurrent
            ) {
              setDateConflict(true);
            }
            return false;
          }
          const currentMarker = dirtyRevision.current;
          const currentMarkerUid = currentMarker
            ? resolveBranch(currentMarker.uid)?.uid ?? currentMarker.uid
            : undefined;
          const requestIsCurrent = currentMarker === null
            ? generation.current === requestGeneration && revision.current === requestRevision
            : currentMarkerUid === requestUid &&
              currentMarker.generation === requestGeneration &&
              currentMarker.revision === requestRevision;
          const latestUid = latest.current
            ? resolveBranch(latest.current.uid)?.uid ?? latest.current.uid
            : undefined;
          if (
            mounted.current &&
            generation.current === requestGeneration &&
            latestUid === requestUid &&
            requestIsCurrent
          ) {
            setSaveFailed(true);
          }
          log.error(
            error instanceof EntryUnavailableError
              ? 'page save refused because the stored page is unavailable'
              : 'page save failed',
            error,
          );
          throw error;
        }
      });

      // Rejections are reported to the caller, but they do not poison the
      // queue: a later edit must still get its turn to save.
      const settledTail = run.then(
        () => undefined,
        () => undefined,
      );
      editorSaveTail = settledTail;
      return run.finally(() => {
        if (
          mounted.current &&
          generation.current === requestGeneration &&
          editorSaveTail === settledTail
        ) {
          setSaving(false);
        }
      });
    },
    [amend, rememberBranch, resolveBranch],
  );

  /** Flushes the newest revision and rejects if it could not be made durable. */
  const flushCurrent = useCallback((): Promise<void> => {
    if (pendingFlush.current) return pendingFlush.current;
    const run = (async () => {
      while (true) {
        const marker = dirtyRevision.current;
        const current = latest.current;
        if (
          !marker ||
          !current ||
          marker.uid !== current.uid ||
          marker.generation !== generation.current ||
          discarded.current.has(current.uid)
        ) {
          await editorSaveTail;
          return;
        }
        const saved = await persist(current, marker.generation);
        if (!saved) throw new EntryDateConflictError(current.date);
        // `persist` clears only the exact revision it wrote. If another edit
        // arrived while it was waiting, loop and flush that newer snapshot too.
      }
    })();
    let tracked: Promise<void>;
    tracked = run.finally(() => {
      if (pendingFlush.current === tracked) pendingFlush.current = null;
    });
    pendingFlush.current = tracked;
    return tracked;
  }, [persist]);

  // Debounced autosave.
  useEffect(() => {
    if (!dirty || !entry) return;
    const timer = window.setTimeout(() => {
      void persist(entry).catch(() => undefined);
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, entry, persist]);

  // Last-chance flush when the page is hidden, closed, or left by hash route.
  useEffect(() => {
    const requestGeneration = generation.current;
    // Stay registered until the route-exit flush settles. A backup started by
    // the destination screen must still await this editor's final revision.
    // The wrapper is unique to this effect setup. Under StrictMode the first
    // setup's delayed unregister must not remove the second setup from the
    // identity-based registry just because both share `flushCurrent`.
    const registeredFlush = () => flushCurrent();
    const unregister = registerPendingWriteFlusher(registeredFlush);
    const flush = () => {
      if (generation.current !== requestGeneration) return;
      void flushCurrent().catch(() => undefined);
    };
    window.addEventListener('pagehide', flush);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      // Hash navigation unmounts the editor without pagehide. The latest
      // revision is queued here before the draft disappears from memory.
      void flushCurrent().then(unregister, unregister);
    };
  }, [entryId, project.uid, initialDate, flushCurrent]);

  /**
   * Photographs are written the moment they are added, not on the debounce.
   *
   * Everything else on this page can be typed again; a photograph taken at ten
   * past seven in a stairwell cannot. The debounce is 1.2 seconds and the app
   * can be closed, backgrounded or killed by iOS inside it, and a phone with a
   * dozen new pictures in a page that was never written is exactly the report
   * that came back missing them.
   */
  const persistPhotos = useCallback(
    (
      owner: DiaryEntry,
      photos: DiaryEntry['photos'],
      ownerGeneration: number,
    ) => {
      const current = latest.current;
      const ownerUid = resolveBranch(owner.uid)?.uid ?? owner.uid;
      const currentUid = current
        ? resolveBranch(current.uid)?.uid ?? current.uid
        : undefined;
      if (
        mounted.current &&
        current &&
        currentUid === ownerUid &&
        generation.current === ownerGeneration
      ) {
        void persist({ ...current, photos }, ownerGeneration).catch(() => undefined);
        return;
      }

      /*
       * Preparing a large batch can finish after this component has unmounted,
       * or after React reused it for another day. Merge the finished photos into
       * their owner's current database row on the shared queue; calling `patch`
       * here would attach them to the newly opened day, while dropping them
       * would lose photographs the user already picked.
      */
      const run = editorSaveTail.then(async () => {
        const branch = resolveBranch(owner.uid);
        const canonicalUid = branch?.uid ?? owner.uid;
        if (discarded.current.has(owner.uid) || discarded.current.has(canonicalUid)) return;
        const stored = await db.entries.where('uid').equals(canonicalUid).first();
        const fallback: DiaryEntry = branch
          ? {
              ...owner,
              id: branch.id,
              uid: branch.uid,
              syncRevision: branch.syncRevision,
              syncConflict: branch.syncConflict,
              syncConflictKind: branch.syncConflictKind,
              syncConflictGroup: branch.syncConflictGroup,
              syncConflictRoot: branch.syncConflictRoot,
            }
          : owner;
        const ownerIds = new Set(owner.photos.map((photo) => photo.id));
        const finished = photos.filter((photo) => !ownerIds.has(photo.id));
        const currentPhotos = stored?.photos ?? owner.photos;
        const currentIds = new Set(currentPhotos.map((photo) => photo.id));
        const saved = await saveEntryChecked({
          ...(stored ?? fallback),
          // Caption/removal callbacks were persisted when they happened. This
          // late callback contributes only the batch that finished preparing,
          // so edits made after reopening the same day stay authoritative.
          photos: [...currentPhotos, ...finished.filter((photo) => !currentIds.has(photo.id))],
        }, stored?.updatedAt ?? branch?.updatedAt ?? null,
        stored?.syncRevision ?? branch?.syncRevision ?? owner.syncRevision ?? null);
        rememberBranch(owner.uid, saved);
        rememberBranch(canonicalUid, saved);
        if (discarded.current.has(owner.uid) || discarded.current.has(canonicalUid)) {
          discarded.current.add(saved.uid);
        }
      });
      editorSaveTail = run.then(
        () => undefined,
        () => undefined,
      );
    },
    [persist, rememberBranch, resolveBranch],
  );

  // The changed keys are the coalescing tag: typing into one field folds into
  // a single step, but moving to another field starts a new one.
  const patch = useCallback(
    (changes: Partial<DiaryEntry>) => {
      const current = latest.current;
      if (current) {
        latest.current = { ...current, ...changes };
        dirtyRevision.current = {
          uid: current.uid,
          generation: generation.current,
          revision: ++revision.current,
        };
      }
      commit((current) => ({ ...current, ...changes }), Object.keys(changes).join(','));
      setDirty(true);
    },
    [commit],
  );

  const patchCasting = useCallback(
    (changes: Partial<DiaryEntry['casting']>) => {
      const current = latest.current;
      if (current) {
        latest.current = { ...current, casting: { ...current.casting, ...changes } };
        dirtyRevision.current = {
          uid: current.uid,
          generation: generation.current,
          revision: ++revision.current,
        };
      }
      commit(
        (current) => ({ ...current, casting: { ...current.casting, ...changes } }),
        `casting.${Object.keys(changes).join(',')}`,
      );
      setDirty(true);
    },
    [commit],
  );

  const stepBack = useCallback(() => {
    const current = latest.current;
    if (current) {
      dirtyRevision.current = {
        uid: current.uid,
        generation: generation.current,
        revision: ++revision.current,
      };
    }
    undo();
    setDirty(true);
  }, [undo]);

  const stepForward = useCallback(() => {
    const current = latest.current;
    if (current) {
      dirtyRevision.current = {
        uid: current.uid,
        generation: generation.current,
        revision: ++revision.current,
      };
    }
    redo();
    setDirty(true);
  }, [redo]);

  /*
   * The bar at the top of the app renders the buttons; this is where they get
   * something to do. Cleared on the way out so they vanish with the editor.
   */
  useEffect(() => {
    publish({ undo: stepBack, redo: stepForward, canUndo, canRedo });
    return () => publish(null);
  }, [publish, stepBack, stepForward, canUndo, canRedo]);

  /*
   * The same seven actions the form used to end with, now at the top.
   *
   * Save is the primary because it is what you came to do; everything else is
   * behind the menu beside it. Deleting is last and marked, so a menu opened to
   * export something never has "delete the page" under the thumb.
   */

  /*
   * ⌘Z and ⌘⇧Z used to be handled here, on a listener of this screen's own.
   * They are in `lib/shortcuts.ts` now, with everything else the keyboard can
   * reach, and they arrive through the actions published just above — so they
   * are listed in Settings and can be rebound like the rest. The one rule that
   * came with them is written down there rather than lost: inside a field the
   * browser's own undo stack wins, because taking it over throws away a
   * sentence when the user meant the last word (`inField: 'skip'`).
   */

  const managementColumns = useMemo<ColumnDef<DiaryEntry['management'][number]>[]>(
    () => [
      { key: 'name', label: t.labelName, options: presets.staff, placeholder: t.phFullName },
      { key: 'role', label: t.labelRole, options: presets.role, placeholder: t.phRole },
    ],
    [presets.staff, presets.role, t],
  );

  const equipmentColumns = useMemo<ColumnDef<DiaryEntry['equipment'][number]>[]>(
    () => [
      { key: 'kind', label: t.labelKind, options: presets.equipment, placeholder: t.phEquipment },
      { key: 'qty', label: t.labelQty, inputMode: 'numeric', placeholder: '1', stepper: true },
      { key: 'hours', label: t.labelHours, inputMode: 'decimal', placeholder: t.phHours },
    ],
    [presets.equipment, t],
  );

  /**
   * The day's sections: what each is called, whether anything is in it, and
   * what it says while it is folded.
   *
   * The summary is the whole idea. A folded section that said only its own name
   * would make the page shorter and less useful at the same time; saying
   * `חשמלאי, אינסטלטור · 5 עובדים` means the fold costs nothing to read past.
   */
  const sections = useMemo(() => {
    if (!entry) return [];
    const firstLine = (text: string) => (text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
    const list = (values: (string | undefined)[]) =>
      values.map((v) => (v ?? '').trim()).filter(Boolean).join(', ');

    const counts = entry.contractors.map(row => parseWorkerCount(row.workers));
    const workers = addExact(counts.flatMap(count => count.value === null ? [] : [count.value]));
    const casting = entry.casting;
    const castingFilled = [
      casting.description,
      casting.sizeQty,
      casting.pump,
      casting.concreteType,
      casting.concreteQty,
      casting.notes,
    ].some((value) => (value ?? '').trim());
    const photoBytes = entry.photos.reduce((sum, photo) => sum + photoSize(photo), 0);

    return [
      {
        id: 'date',
        label: t.sectionProjectDate,
        done: true,
        summary: [formatDdMmYyyy(entry.date), entry.weather.trim()].filter(Boolean).join(' · '),
      },
      {
        id: 'management',
        label: t.sectionManagement,
        done: entry.management.length > 0,
        summary: list(entry.management.map((row) => row.name)),
      },
      {
        id: 'contractors',
        label: t.sectionContractors,
        done: entry.contractors.length > 0,
        summary: [list(entry.contractors.map((row) => row.contractorName || row.trade)), workers !== '0' ? `${workers} ${t.unitWorkers}` : '', counts.some(count => count.issue) ? t.quantityIssues : '']
          .filter(Boolean)
          .join(' · '),
      },
      {
        id: 'equipment',
        label: t.sectionEquipment,
        done: entry.equipment.length > 0,
        summary: list(entry.equipment.map((row) => row.kind)),
      },
      {
        id: 'work',
        label: t.sectionWorkDescription,
        done: Boolean(entry.workDescription.trim()),
        summary: firstLine(entry.workDescription),
      },
      {
        id: 'casting',
        label: t.sectionCasting,
        done: castingFilled,
        summary: [casting.description, casting.concreteQty && `${casting.concreteQty} ${t.unitCubicMetres}`]
          .map((v) => (v ?? '').trim())
          .filter(Boolean)
          .join(' · '),
      },
      {
        id: 'supervisor',
        label: t.sectionSupervisorNotes,
        done: Boolean(entry.supervisorNotes.trim()),
        summary: firstLine(entry.supervisorNotes),
      },
      {
        id: 'received',
        label: t.sectionReceivedToday,
        done: Boolean((entry.receivedToday ?? '').trim()),
        summary: firstLine(entry.receivedToday ?? ''),
      },
      {
        id: 'deliveries',
        label: t.quantityDeliveryLedger,
        done: entry.deliveryLedger?.reviewed ?? false,
        summary: entry.deliveryLedger?.rows.length ? `${entry.deliveryLedger.rows.length} ${t.quantitySourceRows}` : '',
      },
      {
        id: 'signatures',
        label: t.sectionSignatures,
        done: Boolean(entry.managerSignature?.trim()),
        summary: entry.managerSignature?.trim() ? t.statusSigned : '',
      },
      {
        id: 'photos',
        label: t.sectionPhotos,
        done: entry.photos.length > 0,
        summary: entry.photos.length
          ? t.photosSummary(entry.photos.length, formatBytes(photoBytes))
          : '',
      },
    ];
  }, [entry, t]);

  /*
   * Opening one scrolls it under the bars rather than leaving it wherever it
   * happens to be — `scroll-margin-top` on `.card` is what keeps the heading
   * clear of the sticky chrome.
   */
  const showSection = useCallback((id: string) => {
    setOpenSection((current) => (current === id ? '' : id));
    window.requestAnimationFrame(() => {
      document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  /*
   * The handlers go in a ref and the effect depends only on primitives.
   *
   * `saveNow`, `doExport` and the rest are rebuilt on every render, so an effect
   * that listed them — or listed nothing — would publish a new object every
   * render, set state in the parent and re-render without end. The ref keeps the
   * actions calling the current closures without being a dependency of the
   * effect that publishes them.
   */
  const handlers = useRef<Handlers | null>(null);

  const pageId = entry?.id;
  const entryStatus = entry?.status;
  const signedByManager = Boolean(entry?.managerSignature?.trim());
  useEffect(() => {
    if (!entry) {
      publishPage(null);
      return;
    }
    const busy = exporting !== null || explicitBusy !== null;
    const deletionConflict = entry.syncConflictKind === 'deletion';
    publishPage({
      menuTitle: t.pageActions,
      sections: sections.map(({ id, label, done }) => ({ id, label, done })),
      current: openSection,
      onSection: showSection,
      primary: {
        id: 'save',
        label: t.save,
        icon: 'check',
        run: () => void handlers.current?.saveNow(),
        disabled: busy && explicitBusy !== 'save',
        busy: saving || explicitBusy === 'save',
        busyLabel: t.savingNote,
      },
      groups: [
        {
          title: t.actionsExport,
          items: [
            {
              id: 'pdf',
              label: t.exportPdf,
              icon: 'download',
              run: () => void handlers.current?.doExport('pdf'),
              disabled: busy,
              busy: exporting === 'pdf',
              busyLabel: t.generating,
            },
            // A picture arrives in WhatsApp as something already visible, where
            // a PDF arrives as a file to download first — which on a site is the
            // difference between a page being read and being ignored.
            {
              id: 'image',
              label: t.exportImage,
              icon: 'image',
              run: () => void handlers.current?.doExport('image'),
              disabled: busy,
              busy: exporting === 'image',
              busyLabel: t.generating,
            },
            {
              id: 'word',
              label: t.exportWord,
              icon: 'doc',
              run: () => void handlers.current?.doExport('word'),
              disabled: busy,
              busy: exporting === 'word',
              busyLabel: t.exporting,
            },
            ...(canShare
              ? [
                  {
                    id: 'share',
                    label: t.shareButton,
                    icon: 'share' as const,
                    run: () => void handlers.current?.doShare(),
                    disabled: busy,
                    busy: exporting === 'share',
                    busyLabel: t.sharing,
                  },
                ]
              : []),
          ],
        },
        {
          title: t.actionsPage,
          items: [
            ...(pageId !== undefined
              ? [
                  {
                    id: 'preview',
                    label: t.previewButton,
                    icon: 'eye' as const,
                    run: () => navigate(`/preview/${pageId}`),
                    disabled: busy || deletionConflict,
                  },
                ]
              : []),
            /*
              Only while the status is still a choice. Once the מנ"ע has signed,
              the signature decides it — offering "back to draft" there would be
              an action that undoes itself on the next save.
            */
            ...(!signedByManager
              ? [
                  {
                    id: 'status',
                    label: entryStatus === 'signed' ? t.markDraft : t.markSigned,
                    icon: 'pen' as const,
                    run: () => void handlers.current?.toggleSigned(),
                    disabled: busy,
                  },
                ]
              : []),
          ],
        },
        {
          items: [
            {
              id: 'delete',
              label: t.deleteEntry,
              icon: 'trash',
              run: () => void handlers.current?.remove(),
              disabled: busy,
              danger: true,
            },
          ],
        },
      ],
    });
    return () => publishPage(null);
  }, [
    publishPage,
    t,
    exporting,
    explicitBusy,
    saving,
    canShare,
    pageId,
    entryStatus,
    signedByManager,
    entry,
    sections,
    openSection,
    showSection,
  ]);

  if (loading) {
    return <p className="muted">{t.loading}</p>;
  }

  if (loadUnavailable || !entry) {
    return (
      <EmptyState icon="warning" title={t.entryMissingTitle}>
        <p className="muted" style={{ marginBottom: 16 }}>{t.entryMissingBody}</p>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/')}>
          {t.backToDiary}
        </button>
      </EmptyState>
    );
  }

  const beginExplicit = (name: string) => {
    if (explicitOperation.current !== null) return false;
    explicitOperation.current = name;
    setExplicitBusy(name);
    return true;
  };

  const finishExplicit = () => {
    explicitOperation.current = null;
    setExplicitBusy(null);
  };

  const focusSaveProblem = () => {
    window.requestAnimationFrame(() => saveProblem.current?.focus());
  };

  const blockDeletionConflictExport = () => {
    if (entry.syncConflictKind !== 'deletion') return false;
    toast.error(t.syncDeletionConflictBody);
    window.requestAnimationFrame(() => saveProblem.current?.focus());
    return true;
  };

  const saveBeforeAction = async (candidate: DiaryEntry) => {
    try {
      const ok = await persist(candidate);
      if (!ok) {
        toast.error(t.entryExists);
        focusSaveProblem();
      }
      return ok;
    } catch {
      toast.error(t.entrySaveFailed);
      focusSaveProblem();
      return false;
    }
  };

  const saveNow = async () => {
    if (!beginExplicit('save')) return;
    try {
      const ok = await saveBeforeAction(entry);
      if (ok) toast.show(t.entrySaved);
    } finally {
      finishExplicit();
    }
  };

  const toggleSigned = async () => {
    if (!beginExplicit('status')) return;
    const next: DiaryEntry = {
      ...entry,
      status: entry.status === 'signed' ? 'draft' : 'signed',
    };
    latest.current = next;
    dirtyRevision.current = {
      uid: next.uid,
      generation: generation.current,
      revision: ++revision.current,
    };
    setDirty(true);
    commit(() => next, 'status');
    try {
      const ok = await saveBeforeAction(next);
      if (ok) toast.show(next.status === 'signed' ? t.markedSigned : t.markedDraft);
    } finally {
      finishExplicit();
    }
  };

  /** The export libraries are large, so they load on the click, not at startup. */
  const doExport = async (format: 'pdf' | 'word' | 'image') => {
    if (!beginExplicit(format)) return;
    setExporting(format);
    try {
      if (blockDeletionConflictExport()) return;
      if ((dirty || entry.id === undefined) && !(await saveBeforeAction(entry))) return;
      // `null` back from an export means the save dialog was cancelled or the
      // device had nowhere to put the file. Neither is a failure to report, but
      // neither is a file to announce.
      const pdf = await import('../pdf/export');
      const name =
        format === 'pdf'
          ? await pdf.exportEntryPdf(entry, project, { logoDataUrl })
          : format === 'image'
            ? await pdf.exportEntryImage(entry, project, { logoDataUrl })
            : await (await import('../docx/export')).exportEntry(entry, project);
      if (name) toast.show(t.fileCreated(name));
    } catch {
      toast.error(format === 'word' ? t.wordFailed : t.pdfFailed);
    } finally {
      setExporting(null);
      finishExplicit();
    }
  };

  /**
   * The same PDF, handed to the system share sheet instead of a save dialog —
   * which is how a day's page reaches WhatsApp without being saved and hunted
   * down again.
   */
  const doShare = async () => {
    if (!beginExplicit('share')) return;
    setExporting('share');
    try {
      if (blockDeletionConflictExport()) return;
      if ((dirty || entry.id === undefined) && !(await saveBeforeAction(entry))) return;
      const { exportEntryPdf } = await import('../pdf/export');
      await exportEntryPdf(entry, project, { logoDataUrl, deliver: 'share' });
    } catch {
      toast.error(t.pdfFailed);
    } finally {
      setExporting(null);
      finishExplicit();
    }
  };

  const remove = async () => {
    if (!beginExplicit('delete')) return;
    const branchAtDelete = resolveBranch(entry.uid);
    const alreadySaved = branchAtDelete?.id ?? persistedIds.current.get(entry.uid) ?? entry.id;
    if (
      alreadySaved !== undefined &&
      !window.confirm(t.confirmDeleteEntry(formatDdMmYyyy(entry.date)))
    ) {
      finishExplicit();
      return;
    }

    /*
     * Stop accepting snapshots for this page, then wait for the one already in
     * IndexedDB's queue. Deleting first lets that older whole-record put land
     * afterwards and remove `deletedAt`, visibly resurrecting the page.
    */
    const pendingMarker = dirtyRevision.current;
    discarded.current.add(entry.uid);
    if (branchAtDelete) discarded.current.add(branchAtDelete.uid);
    const markerUid = dirtyRevision.current
      ? resolveBranch(dirtyRevision.current.uid)?.uid ?? dirtyRevision.current.uid
      : undefined;
    if (markerUid === (branchAtDelete?.uid ?? entry.uid)) dirtyRevision.current = null;
    setDirty(false);
    let removed = false;
    try {
      await editorSaveTail;

      // A photograph may have caused the first save just before Delete was
      // pressed, while React had not adopted the generated id yet.
      const settledBranch = resolveBranch(entry.uid);
      const id = settledBranch?.id ?? persistedIds.current.get(entry.uid) ?? entry.id;
      if (id !== undefined) {
        await deleteEntry(id);
        toast.show(t.entryDeleted);
      }
      removed = true;
      navigate('/');
    } catch (error) {
      log.error('page deletion failed', error);
      toast.error(t.entryDeleteFailed);
    } finally {
      if (!removed) {
        discarded.current.delete(entry.uid);
        const settledBranch = resolveBranch(entry.uid);
        if (settledBranch) discarded.current.delete(settledBranch.uid);
        if (pendingMarker) {
          dirtyRevision.current = {
            ...pendingMarker,
            uid: settledBranch?.uid ?? pendingMarker.uid,
          };
          setDirty(true);
        }
      }
      finishExplicit();
    }
  };

  // Filled during render, not in an effect: the hook that publishes these has
  // to sit above the loading guard, while the functions themselves are defined
  // below it. A plain assignment crosses that line; a hook call cannot.
  handlers.current = { saveNow, doExport, doShare, toggleSigned, remove };

  /**
   * Fills one of the three tables from the page before this one.
   *
   * A site runs the same trades every day, and writing them out again each
   * morning — on a phone, standing up — is the longest part of filling the
   * form. The rows are copied with fresh ids so editing today's page cannot
   * reach back into yesterday's.
   */
  const copyPrevious = async (which: 'management' | 'contractors' | 'equipment') => {
    if (project.id === undefined) return;
    const previous = await previousEntry(project.id, entry.date);
    const rows = previous?.[which] ?? [];
    if (!previous || rows.length === 0) {
      toast.error(t.noPreviousDay);
      return;
    }
    patch({ [which]: rows.map((row) => ({ ...row, id: uid() })) } as Partial<DiaryEntry>);
    toast.show(t.copiedFrom(formatDdMmYyyy(previous.date)));
  };

  const copyButton = (which: 'management' | 'contractors' | 'equipment') => (
    <button
      type="button"
      className="btn btn--sm btn--brand"
      style={{ marginBottom: 12 }}
      onClick={() => void copyPrevious(which)}
    >
      <Icon name="sync" size={16} />
      {t.copyPrevious}
    </button>
  );

  /** Everything a section's card needs to fold, given its id and its number. */
  const fold = (id: string, step: number) => {
    const section = sections.find((s) => s.id === id);
    return {
      id: `section-${id}`,
      step,
      collapsible: true,
      open: openSection === id,
      onToggle: () => showSection(id),
      summary: section?.summary,
      done: section?.done ?? false,
    };
  };

  // Captured by asynchronous photo callbacks from this particular page render.
  const renderedGeneration = generation.current;

  return (
    <CardsEditorLayout entry={entry} project={project} companyLogo={logoDataUrl}>
      <div className="row row--wrap" style={{ marginBottom: 16 }}>
        <div className="grow">
          <h1>{formatLongDate(entry.date, t)}</h1>
          <p className="muted small">
            {project.name}
            {` · ${saving ? t.savingNote : dirty ? t.unsavedNote : t.savedNote}`}
          </p>
        </div>
        <StatusChip status={entry.status} />
      </div>

      {entry.syncConflict && (
        <div ref={entry.syncConflictKind === 'deletion' ? saveProblem : undefined}
          tabIndex={entry.syncConflictKind === 'deletion' ? -1 : undefined}
          className="card" role="status" style={{ borderColor: 'var(--amber)' }}>
          <div className="card__body">
            <strong>{entry.syncConflictKind === 'deletion'
              ? t.syncDeletionConflictNotice
              : t.syncConflictNotice}</strong>
            <p className="small muted">{entry.syncConflictKind === 'deletion'
              ? t.syncDeletionConflictBody
              : t.syncConflictBody}</p>
          </div>
        </div>
      )}

      {(dateConflict || saveFailed) && (
        <div ref={saveProblem} tabIndex={-1} role="alert">
          {dateConflict && (
            <div className="card" style={{ borderColor: 'var(--danger)' }}>
              <div className="card__body">
                <strong>{t.entryExists}</strong>
                <p className="small muted">{t.entryExistsBody}</p>
              </div>
            </div>
          )}
          {saveFailed && (
            <div className="card" style={{ borderColor: 'var(--danger)' }}>
              <div className="card__body row row--wrap">
                <div className="grow">
                  <strong>{t.entrySaveFailed}</strong>
                  <p className="small muted">{t.entrySaveFailedBody}</p>
                </div>
                <button type="button" className="btn btn--sm" disabled={explicitBusy !== null}
                  onClick={() => void saveNow()}>{t.retry}</button>
              </div>
            </div>
          )}
        </div>
      )}

      <Card title={t.sectionProjectDate} {...fold('date', 1)}>
        <div className="grid-2">
          <Field label={t.labelDate}>
            <input
              type="date"
              value={entry.date}
              onChange={(e) => patch({ date: e.target.value })}
            />
          </Field>
          <Field label={t.labelWeather}>
            <Combobox
              value={entry.weather}
              onChange={(weather) => patch({ weather })}
              options={presets.weather}
              listId="opts-weather"
              placeholder={t.phWeather}
            />
          </Field>
        </div>
        <p className="card__note">
          {t.hintProjectDate}
        </p>
      </Card>

      <Card title={t.sectionManagement} note={t.hintManagement} {...fold('management', 2)}>
        {copyButton('management')}
        <RowsEditor
          rows={entry.management}
          columns={managementColumns}
          onChange={(management) => patch({ management })}
          addLabel={t.addStaff}
          emptyValue={{ name: '', role: '' }}
        />
      </Card>

      <Card title={t.sectionContractors} note={t.hintContractors} {...fold('contractors', 3)}>
        {copyButton('contractors')}
        <ContractorRowsEditor key={entry.uid} rows={entry.contractors} tradeOptions={presets.trade}
          onChange={(contractors) => patch({ contractors })} />
      </Card>

      <Card title={t.sectionEquipment} note={t.hintEquipment} {...fold('equipment', 4)}>
        {copyButton('equipment')}
        <RowsEditor
          rows={entry.equipment}
          columns={equipmentColumns}
          onChange={(equipment) => patch({ equipment })}
          addLabel={t.addEquipment}
          emptyValue={{ kind: '', qty: '', hours: '' }}
        />
      </Card>

      <Card title={t.sectionWorkDescription} {...fold('work', 5)}>
        <Field label={t.labelDescription} hint={t.hintDescriptionLines}>
          <textarea
            value={entry.workDescription}
            onChange={(e) => patch({ workDescription: e.target.value })}
            placeholder={t.phWorkDescription}
          />
        </Field>
      </Card>

      <Card title={t.sectionCasting} note={t.hintCasting} {...fold('casting', 6)}>
        <div className="grid-2">
          <Field label={t.labelDescription}>
            <input
              type="text"
              value={entry.casting.description}
              onChange={(e) => patchCasting({ description: e.target.value })}
              placeholder={t.phCastingDescription}
            />
          </Field>
          <Field label={t.labelSizeQty}>
            <input
              type="text"
              value={entry.casting.sizeQty}
              onChange={(e) => patchCasting({ sizeQty: e.target.value })}
              placeholder={t.phSizeQty}
            />
          </Field>
          <Field label={t.labelPump}>
            <input
              type="text"
              value={entry.casting.pump}
              onChange={(e) => patchCasting({ pump: e.target.value })}
              placeholder={t.phPump}
            />
          </Field>
          <Field label={t.labelConcreteType}>
            <Combobox
              value={entry.casting.concreteType}
              onChange={(concreteType) => patchCasting({ concreteType })}
              options={presets.concreteType}
              listId="opts-concrete"
              placeholder={t.phConcreteType}
            />
          </Field>
          <Field label={t.labelConcreteQty}>
            <input
              type="text"
              inputMode="decimal"
              value={entry.casting.concreteQty}
              onChange={(e) => patchCasting({ concreteQty: e.target.value })}
              placeholder={t.phConcreteQty}
            />
          </Field>
          <Field label={t.labelConcreteTypeNote}>
            <input
              type="text"
              value={entry.casting.notesConcreteType}
              onChange={(e) => patchCasting({ notesConcreteType: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t.labelNotes}>
          <input
            type="text"
            value={entry.casting.notes}
            onChange={(e) => patchCasting({ notes: e.target.value })}
          />
        </Field>
      </Card>

      <Card title={t.sectionSupervisorNotes} {...fold('supervisor', 7)}>
        <textarea
          value={entry.supervisorNotes}
          onChange={(e) => patch({ supervisorNotes: e.target.value })}
          placeholder={t.phSupervisorNotes}
        />
      </Card>

      <Card title={t.sectionReceivedToday} {...fold('received', 8)}>
        <textarea
          value={entry.receivedToday ?? ''}
          onChange={(e) => patch({ receivedToday: e.target.value })}
          placeholder={t.phReceivedToday}
          rows={3}
        />
      </Card>

      <Card title={t.quantityDeliveryLedger} {...fold('deliveries', 9)}>
        <QuantityLedger key={entry.uid} ledger={entry.deliveryLedger} onChange={deliveryLedger => patch({ deliveryLedger })} />
      </Card>

      <Card title={t.sectionSignatures} note={t.hintSignatures} {...fold('signatures', 10)}>
        <div className="stack">
          <SignaturePad
            label={t.labelSupervisorSignature}
            value={entry.supervisorSignature}
            saved={savedSignatures.supervisor}
            onChange={(supervisorSignature) => patch({ supervisorSignature })}
          />
          <SignaturePad
            label={t.labelManagerSignature}
            value={entry.managerSignature}
            saved={savedSignatures.manager}
            // `saveEntry` applies the same rule, but only on the next save; the
            // chip at the top of the screen has to answer straight away, or
            // signing looks like it did nothing.
            onChange={(managerSignature) =>
              patch(
                managerSignature.trim()
                  ? { managerSignature, status: 'signed' }
                  : { managerSignature },
              )
            }
          />
        </div>
      </Card>

      <Card title={t.sectionPhotos} note={t.hintPhotos} {...fold('photos', 11)}>
        <PhotoGrid
          photos={entry.photos}
          onChange={(photos) => {
            if (
              latest.current?.uid === entry.uid &&
              generation.current === renderedGeneration
            ) {
              patch({ photos });
            }
            persistPhotos(entry, photos, renderedGeneration);
          }}
          onError={toast.error}
        />
      </Card>
    </CardsEditorLayout>
  );
}
