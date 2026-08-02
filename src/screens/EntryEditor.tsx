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
import { blankEntry, db, deleteEntry, findEntryByDate, saveEntry } from '../db';
import { formatDdMmYyyy, formatLongDate, isoDate } from '../lib/dates';
import { usePresets } from '../hooks/useData';
import { useCompanyLogo } from '../hooks/useBranding';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { navigate } from '../hooks/useRoute';
import { Card, Combobox, Field, StatusChip } from '../components/ui';
import { RowsEditor, type ColumnDef } from '../components/RowsEditor';
import { SignaturePad } from '../components/SignaturePad';
import { useSavedSignatures } from '../hooks/useSignatures';
import { PhotoGrid } from '../components/PhotoGrid';

const AUTOSAVE_MS = 1200;

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

  const [entry, setEntry] = useState<DiaryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dateConflict, setDateConflict] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'word' | null>(null);
  const latest = useRef<DiaryEntry | null>(null);

  // Load once; afterwards this component owns the draft in local state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fresh = () => blankEntry(project.id!, initialDate ?? isoDate(), project.uid);
      const loaded = entryId === undefined ? fresh() : await db.entries.get(entryId);
      if (cancelled) return;
      setEntry(loaded ?? fresh());
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId, project.id, project.uid, initialDate]);

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
        if (candidate.id === undefined) {
          // First save of a new page: adopt the generated id, and swap the URL
          // so a refresh reopens the same page instead of a second blank one.
          setEntry((current) => (current ? { ...current, id } : current));
          window.history.replaceState(null, '', `#/entry/${id}`);
        }
        setDirty(false);
        return true;
      } finally {
        setSaving(false);
      }
    },
    [],
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

  const patch = useCallback((changes: Partial<DiaryEntry>) => {
    setEntry((current) => (current ? { ...current, ...changes } : current));
    setDirty(true);
  }, []);

  const patchCasting = useCallback(
    (changes: Partial<DiaryEntry['casting']>) => {
      setEntry((current) =>
        current ? { ...current, casting: { ...current.casting, ...changes } } : current,
      );
      setDirty(true);
    },
    [],
  );

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
      { key: 'workers', label: t.labelWorkers, inputMode: 'numeric', placeholder: '0' },
    ],
    [presets.trade, t],
  );

  const equipmentColumns = useMemo<ColumnDef<DiaryEntry['equipment'][number]>[]>(
    () => [
      { key: 'kind', label: t.labelKind, options: presets.equipment, placeholder: t.phEquipment },
      { key: 'qty', label: t.labelQty, inputMode: 'numeric', placeholder: '1' },
      { key: 'hours', label: t.labelHours, inputMode: 'decimal', placeholder: t.phHours },
    ],
    [presets.equipment, t],
  );

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
    setEntry(next);
    const ok = await persist(next);
    if (ok) toast.show(next.status === 'signed' ? t.markedSigned : t.markedDraft);
  };

  /** The export libraries are large, so they load on the click, not at startup. */
  const doExport = async (format: 'pdf' | 'word') => {
    setExporting(format);
    try {
      if (dirty) await persist(entry);
      if (format === 'pdf') {
        const { exportEntryPdf } = await import('../pdf/export');
        toast.show(t.fileCreated(await exportEntryPdf(entry, project, { logoDataUrl })));
      } else {
        const { exportEntry } = await import('../docx/export');
        toast.show(t.fileCreated(await exportEntry(entry, project)));
      }
    } catch {
      toast.error(format === 'pdf' ? t.pdfFailed : t.wordFailed);
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

      <Card title={t.sectionProjectDate} step={1}>
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

      <Card title={t.sectionManagement} step={2} note={t.hintManagement}>
        <RowsEditor
          rows={entry.management}
          columns={managementColumns}
          onChange={(management) => patch({ management })}
          addLabel={t.addStaff}
          emptyValue={{ name: '', role: '' }}
        />
      </Card>

      <Card title={t.sectionContractors} step={3} note={t.hintContractors}>
        <RowsEditor
          rows={entry.contractors}
          columns={contractorColumns}
          onChange={(contractors) => patch({ contractors })}
          addLabel={t.addContractor}
          emptyValue={{ trade: '', workers: '' }}
        />
      </Card>

      <Card title={t.sectionEquipment} step={4} note={t.hintEquipment}>
        <RowsEditor
          rows={entry.equipment}
          columns={equipmentColumns}
          onChange={(equipment) => patch({ equipment })}
          addLabel={t.addEquipment}
          emptyValue={{ kind: '', qty: '', hours: '' }}
        />
      </Card>

      <Card title={t.sectionWorkDescription} step={5}>
        <Field label={t.labelDescription} hint={t.hintDescriptionLines}>
          <textarea
            value={entry.workDescription}
            onChange={(e) => patch({ workDescription: e.target.value })}
            placeholder={t.phWorkDescription}
          />
        </Field>
      </Card>

      <Card title={t.sectionCasting} step={6} note={t.hintCasting}>
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

      <Card title={t.sectionSupervisorNotes} step={7}>
        <textarea
          value={entry.supervisorNotes}
          onChange={(e) => patch({ supervisorNotes: e.target.value })}
          placeholder={t.phSupervisorNotes}
        />
      </Card>

      <Card title={t.sectionReceivedToday} step={8}>
        <textarea
          value={entry.receivedToday ?? ''}
          onChange={(e) => patch({ receivedToday: e.target.value })}
          placeholder={t.phReceivedToday}
          rows={3}
        />
      </Card>

      <Card title={t.sectionSignatures} step={9} note={t.hintSignatures}>
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
            onChange={(managerSignature) => patch({ managerSignature })}
          />
        </div>
      </Card>

      <Card title={t.sectionPhotos} step={10} note={t.hintPhotos}>
        <PhotoGrid
          photos={entry.photos}
          onChange={(photos) => patch({ photos })}
          onError={toast.error}
        />
      </Card>

      <div className="btn-row" style={{ marginBottom: 24 }}>
        <button type="button" className="btn btn--primary" onClick={() => void saveNow()}>
          {t.save}
        </button>
        <button
          type="button"
          className="btn btn--brand"
          disabled={exporting !== null}
          onClick={() => void doExport('pdf')}
        >
          {exporting === 'pdf' ? t.generating : `⬇ ${t.exportPdf}`}
        </button>
        <button
          type="button"
          className="btn"
          disabled={exporting !== null}
          onClick={() => void doExport('word')}
        >
          {exporting === 'word' ? t.exporting : t.exportWord}
        </button>
        {entry.id !== undefined && (
          <button
            type="button"
            className="btn"
            onClick={() => navigate(`/preview/${entry.id}`)}
          >
            {t.previewButton}
          </button>
        )}
        <button type="button" className="btn" onClick={() => void toggleSigned()}>
          {entry.status === 'signed' ? t.markDraft : t.markSigned}
        </button>
        <button type="button" className="btn btn--danger" onClick={() => void remove()}>
          {t.deleteEntry}
        </button>
      </div>
    </div>
  );
}
