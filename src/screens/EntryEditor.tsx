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
import { blankEntry, db, deleteEntry, findEntryByDate, previousEntry, saveEntry, statusFor } from '../db';
import { formatDdMmYyyy, formatLongDate, isoDate } from '../lib/dates';
import { formatBytes } from '../lib/images';
import { photoSize } from '../lib/photoData';
import { parseNum } from '../docx/summary';
import { usePresets } from '../hooks/useData';
import { uid } from '../lib/id';
import { useCompanyLogo } from '../hooks/useBranding';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { navigate } from '../hooks/useRoute';
import { Card, Combobox, Field, StatusChip } from '../components/ui';
import { Icon } from '../components/Icon';
import { RowsEditor, type ColumnDef } from '../components/RowsEditor';
import { SignaturePad } from '../components/SignaturePad';
import { useSavedSignatures } from '../hooks/useSignatures';
import { PhotoGrid } from '../components/PhotoGrid';
import { canShareFiles } from '../lib/save';
import { useUndoable } from '../hooks/useUndoable';
import { useEditorActions } from '../hooks/editorActionsContext';

const AUTOSAVE_MS = 1200;

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
  const { publish, publishPage } = useEditorActions();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dateConflict, setDateConflict] = useState(false);
  /*
   * Which section is unfolded. One at a time, deliberately: with ten of them
   * open the page was four screens long, and the point of folding them is that
   * the whole day fits on one.
   */
  const [openSection, setOpenSection] = useState<string>('');
  const [exporting, setExporting] = useState<'pdf' | 'word' | 'share' | 'image' | null>(null);
  // Offered only where a share sheet exists; on a plain desktop browser it
  // would do nothing the export buttons do not already do.
  const canShare = useMemo(() => canShareFiles(), []);
  const latest = useRef<DiaryEntry | null>(null);

  // Load once; afterwards this component owns the draft in local state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fresh = () => blankEntry(project.id!, initialDate ?? isoDate(), project.uid);
      const loaded = entryId === undefined ? fresh() : await db.entries.get(entryId);
      if (cancelled) return;
      // A different page means a different history; nothing from the last one
      // should be reachable by pressing undo here.
      const page = loaded ?? fresh();
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

  latest.current = entry;

  const persist = useCallback(
    async (candidate: DiaryEntry): Promise<boolean> => {
      const clash = await findEntryByDate(candidate.projectId, candidate.date);
      if (clash && clash.id !== candidate.id) {
        setDateConflict(true);
        return false;
      }
      setDateConflict(false);
      setSaving(true);
      try {
        const id = await saveEntry(candidate);
        // `saveEntry` decides the status from the מנ"ע signature. Without
        // reflecting that back, the chip at the top of the screen keeps saying
        // "draft" for a page the database has already recorded as active.
        const settled = statusFor(candidate);
        if (settled !== candidate.status) {
          // `amend`, not `commit`: the database decided this, not the user, so
          // it must not be something undo steps back through.
          amend((current) => ({ ...current, status: settled }));
        }
        if (candidate.id === undefined) {
          // First save of a new page: adopt the generated id, and swap the URL
          // so a refresh reopens the same page instead of a second blank one.
          amend((current) => ({ ...current, id }));
          window.history.replaceState(null, '', `#/entry/${id}`);
        }
        setDirty(false);
        return true;
      } finally {
        setSaving(false);
      }
    },
    [amend],
  );

  // Debounced autosave.
  useEffect(() => {
    if (!dirty || !entry) return;
    const timer = window.setTimeout(() => {
      void persist(entry);
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, entry, persist]);

  // Last-chance flush when the page is hidden or closed.
  useEffect(() => {
    const flush = () => {
      if (dirty && latest.current) void persist(latest.current);
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [dirty, persist]);

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
    (photos: DiaryEntry['photos']) => {
      const current = latest.current;
      if (current) void persist({ ...current, photos });
    },
    [persist],
  );

  // The changed keys are the coalescing tag: typing into one field folds into
  // a single step, but moving to another field starts a new one.
  const patch = useCallback(
    (changes: Partial<DiaryEntry>) => {
      commit((current) => ({ ...current, ...changes }), Object.keys(changes).join(','));
      setDirty(true);
    },
    [commit],
  );

  const patchCasting = useCallback(
    (changes: Partial<DiaryEntry['casting']>) => {
      commit(
        (current) => ({ ...current, casting: { ...current.casting, ...changes } }),
        `casting.${Object.keys(changes).join(',')}`,
      );
      setDirty(true);
    },
    [commit],
  );

  const stepBack = useCallback(() => {
    undo();
    setDirty(true);
  }, [undo]);

  const stepForward = useCallback(() => {
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

  const contractorColumns = useMemo<ColumnDef<DiaryEntry['contractors'][number]>[]>(
    () => [
      { key: 'trade', label: t.labelTrade, options: presets.trade, placeholder: t.phTrade },
      { key: 'workers', label: t.labelWorkers, inputMode: 'numeric', placeholder: '0', stepper: true },
    ],
    [presets.trade, t],
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

    const workers = entry.contractors.reduce((sum, row) => sum + parseNum(row.workers), 0);
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
        summary: [list(entry.contractors.map((row) => row.trade)), workers > 0 ? t.workersShort(workers) : '']
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
    const busy = exporting !== null;
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
        busy: saving,
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

  if (loading || !entry) {
    return <p className="muted">{t.loading}</p>;
  }

  const saveNow = async () => {
    const ok = await persist(entry);
    if (ok) toast.show(t.entrySaved);
    else toast.error(t.entryExists);
  };

  const toggleSigned = async () => {
    const next: DiaryEntry = {
      ...entry,
      status: entry.status === 'signed' ? 'draft' : 'signed',
    };
    commit(() => next, 'status');
    const ok = await persist(next);
    if (ok) toast.show(next.status === 'signed' ? t.markedSigned : t.markedDraft);
  };

  /** The export libraries are large, so they load on the click, not at startup. */
  const doExport = async (format: 'pdf' | 'word' | 'image') => {
    setExporting(format);
    try {
      if (dirty) await persist(entry);
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
    }
  };

  /**
   * The same PDF, handed to the system share sheet instead of a save dialog —
   * which is how a day's page reaches WhatsApp without being saved and hunted
   * down again.
   */
  const doShare = async () => {
    setExporting('share');
    try {
      if (dirty) await persist(entry);
      const { exportEntryPdf } = await import('../pdf/export');
      await exportEntryPdf(entry, project, { logoDataUrl, deliver: 'share' });
    } catch {
      toast.error(t.pdfFailed);
    } finally {
      setExporting(null);
    }
  };

  const remove = async () => {
    if (entry.id === undefined) {
      navigate('/');
      return;
    }
    if (!window.confirm(t.confirmDeleteEntry(formatDdMmYyyy(entry.date)))) return;
    await deleteEntry(entry.id);
    toast.show(t.entryDeleted);
    navigate('/');
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


  return (
    <div>
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

      {dateConflict && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <div className="card__body">
            <strong>{t.entryExists}</strong>
            <p className="small muted">{t.entryExistsBody}</p>
          </div>
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
        <RowsEditor
          rows={entry.contractors}
          columns={contractorColumns}
          onChange={(contractors) => patch({ contractors })}
          addLabel={t.addContractor}
          emptyValue={{ trade: '', workers: '' }}
        />
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

      <Card title={t.sectionSignatures} note={t.hintSignatures} {...fold('signatures', 9)}>
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

      <Card title={t.sectionPhotos} note={t.hintPhotos} {...fold('photos', 10)}>
        <PhotoGrid
          photos={entry.photos}
          onChange={(photos) => {
            patch({ photos });
            persistPhotos(photos);
          }}
          onError={toast.error}
        />
      </Card>

    </div>
  );
}
