/**
 * The wide-screen diary: a bounded month rail, the real A4 preview, and one
 * place to choose how the current page leaves the device.
 *
 * The rail deliberately reads one month at a time. Diary entries carry their
 * photographs inside IndexedDB, so loading a whole project just to draw a date
 * list would also deserialize every photograph in that project.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DiaryEntry, Project } from '../types';
import { db, statusFor } from '../db';
import { flushPendingWrites } from '../lib/pendingWrites';
import { canShareFiles, type Deliver } from '../lib/save';
import { reportConflictState } from '../lib/reportConflicts';
import {
  formatLongDate,
  isoDate,
  monthLabel,
  monthRange,
  shiftedMonthRange,
  weekday,
} from '../lib/dates';
import { photoPageCount } from '../lib/photoPages';
import { useLanguage } from '../i18n/useLanguage';
import { navigate } from '../hooks/useRoute';
import { setActiveProject } from '../hooks/useData';
import { useCompanyLogo } from '../hooks/useBranding';
import { useDocThemeId } from '../hooks/useDocTheme';
import { useToast } from '../hooks/toastContext';
import { useEditorActions } from '../hooks/editorActionsContext';
import { Icon } from './Icon';
import { PhotoSheet, SheetPreview } from './SheetPreview';
import { SheetScaler } from './SheetScaler';

type DesktopExportFormat = 'pdf' | 'word' | 'image';

function belongsToProject(entry: DiaryEntry | undefined, project: Project): entry is DiaryEntry {
  if (!entry || entry.deletedAt !== undefined || project.id === undefined) return false;
  return (
    entry.projectId === project.id &&
    (!entry.projectUid || entry.projectUid === project.uid)
  );
}

function safePreviewEntry(entry: DiaryEntry): DiaryEntry {
  // A restored page may predate one of the array fields even though pages made
  // by current builds are complete. The preview must remain useful while that
  // older page is being reviewed.
  return {
    ...entry,
    management: entry.management ?? [],
    contractors: entry.contractors ?? [],
    equipment: entry.equipment ?? [],
    photos: entry.photos ?? [],
  };
}

function uniqueEntries(entries: DiaryEntry[]): DiaryEntry[] {
  return [...new Map(entries.map((entry) => [entry.uid, entry])).values()];
}

export function DesktopDiaryWorkspace({
  project,
  entry,
}: {
  project: Project;
  entry?: DiaryEntry;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const logoDataUrl = useCompanyLogo();
  const themeId = useDocThemeId();
  const { publishPage } = useEditorActions();
  const routedEntry = belongsToProject(entry, project) ? entry : undefined;
  const routedEntryId = routedEntry?.id;
  const routedEntryDate = routedEntry?.date;
  const [month, setMonth] = useState(() => (routedEntry?.date ?? isoDate()).slice(0, 7));
  const [format, setFormat] = useState<DesktopExportFormat>('pdf');
  const [busy, setBusy] = useState<{ format: DesktopExportFormat; deliver: Deliver } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [defaultMonthReady, setDefaultMonthReady] = useState(Boolean(routedEntry));
  const busyRef = useRef(false);
  const canShare = useMemo(() => canShareFiles(), []);

  const range = useMemo(() => monthRange(`${month}-01`), [month]);
  const monthQueryKey = `${project.uid}:${month}`;
  const loadedMonth = useLiveQuery(async () => {
    if (project.id === undefined) return { key: monthQueryKey, rows: [] as DiaryEntry[] };
    const rows = await db.entries
      .where('[projectId+date]')
      .between([project.id, range.from], [project.id, range.to], true, true)
      .filter(
        (candidate) =>
          candidate.deletedAt === undefined &&
          (!candidate.projectUid || candidate.projectUid === project.uid),
      )
      .toArray();
    return { key: monthQueryKey, rows: rows.sort((a, b) => b.date.localeCompare(a.date)) };
  }, [monthQueryKey, project.id, project.uid, range.from, range.to]);
  const monthEntries = loadedMonth?.key === monthQueryKey ? loadedMonth.rows : undefined;

  const recentQueryKey = project.uid;
  const loadedRecent = useLiveQuery(async () => {
    if (project.id === undefined || routedEntry) {
      return { key: recentQueryKey, entry: undefined as DiaryEntry | undefined };
    }
    const latest = await db.entries
      .where('[projectId+date]')
      .between([project.id, ''], [project.id, '\uffff'], true, true)
      .reverse()
      .filter(
        (candidate) =>
          candidate.deletedAt === undefined &&
          (!candidate.projectUid || candidate.projectUid === project.uid),
      )
      .first();
    return { key: recentQueryKey, entry: latest };
  }, [project.id, project.uid, recentQueryKey, routedEntry?.uid]);
  const recentEntry = loadedRecent?.key === recentQueryKey ? loadedRecent.entry : undefined;

  // Route navigation selects a day and brings its month into the rail. Changing
  // the month input itself does not retrigger this effect, so every month stays
  // reachable while a page remains open in the centre.
  useEffect(() => {
    if (!routedEntryDate) return;
    setMonth(routedEntryDate.slice(0, 7));
    setDefaultMonthReady(true);
  }, [routedEntryId, routedEntryDate]);

  useEffect(() => {
    if (routedEntryDate || defaultMonthReady || loadedRecent?.key !== recentQueryKey) return;
    if (recentEntry) setMonth(recentEntry.date.slice(0, 7));
    setDefaultMonthReady(true);
  }, [defaultMonthReady, loadedRecent?.key, recentEntry, recentQueryKey, routedEntryDate]);

  const visibleMonthEntries = routedEntry || defaultMonthReady ? monthEntries : undefined;

  const displayedEntry = useMemo(() => {
    if (routedEntry) {
      return visibleMonthEntries?.find((candidate) => candidate.uid === routedEntry.uid) ?? routedEntry;
    }
    return visibleMonthEntries?.[0];
  }, [routedEntry, visibleMonthEntries]);
  const previewEntry = displayedEntry ? safePreviewEntry(displayedEntry) : undefined;
  const selectedConflictKey = displayedEntry
    ? `${project.uid}:${displayedEntry.uid}:${displayedEntry.date}:${displayedEntry.syncConflictGroup ?? ''}`
    : `${project.uid}:none`;
  const loadedSelectedConflict = useLiveQuery(async () => {
    if (!displayedEntry || project.id === undefined) {
      return { key: selectedConflictKey, entries: [] as DiaryEntry[] };
    }
    const entries = await db.transaction('r', db.entries, async () => {
      const sameDate = await db.entries
        .where('[projectId+date]')
        .equals([project.id as number, displayedEntry.date])
        .filter(
          (candidate) =>
            candidate.deletedAt === undefined &&
            (!candidate.projectUid || candidate.projectUid === project.uid),
        )
        .toArray();
      if (!displayedEntry.syncConflictGroup) return sameDate;

      // A concurrent editor may change one preserved branch's date. There is
      // no index for this rare recovery metadata, so scan this one project only
      // when a selected page actually carries a group, then merge it with the
      // indexed same-date lookup above.
      const linked = await db.entries
        .where('projectId')
        .equals(project.id as number)
        .filter(
          (candidate) =>
            candidate.deletedAt === undefined &&
            candidate.syncConflictGroup === displayedEntry.syncConflictGroup &&
            (!candidate.projectUid || candidate.projectUid === project.uid),
        )
        .toArray();
      return uniqueEntries([...sameDate, ...linked]);
    });
    return { key: selectedConflictKey, entries };
  }, [displayedEntry?.date, displayedEntry?.uid, project.id, project.uid, selectedConflictKey]);
  const selectedConflictState =
    loadedSelectedConflict?.key === selectedConflictKey
      ? reportConflictState(loadedSelectedConflict.entries)
      : undefined;
  const conflict = Boolean(
    displayedEntry && selectedConflictState?.dates.includes(displayedEntry.date),
  );
  const conflictLoading = Boolean(displayedEntry && !selectedConflictState);
  const monthConflictDates = useMemo(
    () => new Set(reportConflictState(visibleMonthEntries ?? []).dates),
    [visibleMonthEntries],
  );
  const pageCount = previewEntry
    ? 1 + photoPageCount(previewEntry.photos.length)
    : 0;

  const readFreshTarget = async (
    candidate: DiaryEntry,
  ): Promise<{ entry: DiaryEntry; project: Project } | null> => {
    try {
      await flushPendingWrites();
      if (candidate.id === undefined || project.id === undefined) {
        setError(t.desktopEntryChanged);
        return null;
      }

      const snapshot = await db.transaction('r', db.projects, db.entries, async () => {
        const [freshEntry, freshProject] = await Promise.all([
          db.entries.get(candidate.id as number),
          db.projects.get(project.id as number),
        ]);
        if (!freshEntry || !freshProject) return { freshEntry, freshProject, conflict: false };
        const sameDate = await db.entries
          .where('[projectId+date]')
          .equals([freshProject.id as number, freshEntry.date])
          .filter(
            (other) =>
              other.deletedAt === undefined &&
              (!other.projectUid || other.projectUid === freshProject.uid),
          )
          .toArray();
        const linked = freshEntry.syncConflictGroup
          ? await db.entries
              .where('projectId')
              .equals(freshProject.id as number)
              .filter(
                (other) =>
                  other.deletedAt === undefined &&
                  other.syncConflictGroup === freshEntry.syncConflictGroup &&
                  (!other.projectUid || other.projectUid === freshProject.uid),
              )
              .toArray()
          : [];
        const related = uniqueEntries([...sameDate, ...linked]);
        return {
          freshEntry,
          freshProject,
          conflict: reportConflictState(related).dates.includes(freshEntry.date),
        };
      });
      const { freshEntry, freshProject } = snapshot;
      if (
        !freshEntry ||
        !freshProject ||
        freshEntry.uid !== candidate.uid ||
        freshProject.uid !== project.uid ||
        freshEntry.deletedAt !== undefined ||
        freshEntry.projectId !== freshProject.id ||
        (freshEntry.projectUid && freshEntry.projectUid !== freshProject.uid)
      ) {
        setError(t.desktopEntryChanged);
        return null;
      }
      if (snapshot.conflict) {
        setError(t.desktopConflictExportBody);
        return null;
      }
      return { entry: safePreviewEntry(freshEntry), project: freshProject };
    } catch {
      setError(t.desktopExportRefreshFailed);
      return null;
    }
  };

  const runExport = async (nextFormat: DesktopExportFormat, deliver: Deliver) => {
    if (busyRef.current || !displayedEntry) return;
    busyRef.current = true;
    setBusy({ format: nextFormat, deliver });
    setError(null);
    try {
      const fresh = await readFreshTarget(displayedEntry);
      if (!fresh) return;

      let name: string | null = null;
      if (nextFormat === 'pdf') {
        const { exportEntryPdf } = await import('../pdf/export');
        name = await exportEntryPdf(fresh.entry, fresh.project, { logoDataUrl, deliver });
      } else if (nextFormat === 'image') {
        const { exportEntryImage } = await import('../pdf/export');
        name = await exportEntryImage(fresh.entry, fresh.project, { logoDataUrl, deliver });
      } else {
        const { exportEntry } = await import('../docx/export');
        name = await exportEntry(fresh.entry, fresh.project, { deliver });
      }

      // Export helpers return null for a cancelled dialog. A success message is
      // only true when an actual file name came back from the delivery route.
      if (name) toast.show(t.fileCreated(name));
    } catch {
      const message =
        nextFormat === 'word'
          ? t.wordFailed
          : nextFormat === 'image'
            ? t.desktopImageFailed
            : t.pdfFailed;
      setError(message);
      toast.error(message);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const latest = useRef({ runExport });
  latest.current = { runExport };

  // The desktop shell hides the ordinary action bar, but publishing the same
  // operations keeps the established keyboard shortcuts working.
  useEffect(() => {
    const disabled = !displayedEntry || conflict || conflictLoading || busy !== null;
    publishPage({
      menuTitle: t.pageActions,
      primary: {
        id: 'pdf',
        label: t.exportPdf,
        icon: 'download',
        run: () => void latest.current.runExport('pdf', 'save'),
        disabled,
        busy: busy?.format === 'pdf',
        busyLabel: t.generating,
      },
      groups: [
        {
          title: t.actionsExport,
          items: [
            {
              id: 'image',
              label: t.exportImage,
              icon: 'image',
              run: () => void latest.current.runExport('image', 'save'),
              disabled,
              busy: busy?.format === 'image',
              busyLabel: t.exporting,
            },
            {
              id: 'word',
              label: t.exportWord,
              icon: 'doc',
              run: () => void latest.current.runExport('word', 'save'),
              disabled,
              busy: busy?.format === 'word',
              busyLabel: t.exporting,
            },
            ...(canShare
              ? [
                  {
                    id: 'share',
                    label: t.shareButton,
                    icon: 'share' as const,
                    run: () => void latest.current.runExport(format, 'share'),
                    disabled,
                    busy: busy?.deliver === 'share',
                    busyLabel: t.sharing,
                  },
                ]
              : []),
          ],
        },
      ],
    });
    return () => publishPage(null);
  }, [busy, canShare, conflict, conflictLoading, displayedEntry, format, publishPage, t]);

  const shiftMonth = (delta: number) => {
    setMonth(shiftedMonthRange(`${month}-01`, delta).from.slice(0, 7));
  };

  const navigateWithinProject = async (path: string) => {
    if (project.id === undefined) {
      setError(t.projectSwitchFailed);
      return;
    }
    try {
      await setActiveProject(project.id);
      navigate(path);
    } catch {
      setError(t.projectSwitchFailed);
      toast.error(t.projectSwitchFailed);
    }
  };

  const conflictTitle =
    displayedEntry?.syncConflictKind === 'deletion'
      ? t.syncDeletionConflictNotice
      : t.syncConflictNotice;
  const conflictBody =
    displayedEntry?.syncConflictKind === 'deletion'
      ? t.syncDeletionConflictBody
      : t.syncConflictBody;
  const primaryBusy = busy?.deliver === (canShare ? 'share' : 'save');

  return (
    <div className="desktop-diary">
      <aside className="desktop-days" aria-label={t.desktopRailLabel}>
        <div className="desktop-days__header">
          <div className="desktop-days__month-nav">
            <button
              type="button"
              className="desktop-days__month-button"
              aria-label={t.desktopPreviousMonth}
              onClick={() => shiftMonth(-1)}
            >
              <Icon name="chevron" size={16} />
            </button>
            <label className="desktop-days__month-label">
              <h2>{monthLabel(`${month}-01`, t)}</h2>
              <input
                className="desktop-days__month-input"
                type="month"
                value={month}
                aria-label={t.desktopMonthPicker}
                onChange={(event) => {
                  if (/^\d{4}-\d{2}$/.test(event.currentTarget.value)) {
                    setMonth(event.currentTarget.value);
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="desktop-days__month-button desktop-days__month-button--next"
              aria-label={t.desktopNextMonth}
              onClick={() => shiftMonth(1)}
            >
              <Icon name="chevron" size={16} />
            </button>
          </div>
          <span className="desktop-days__count">
            {visibleMonthEntries === undefined
              ? t.loading
              : t.desktopMonthPages(visibleMonthEntries.length)}
          </span>
        </div>

        <div className="desktop-days__list">
          {visibleMonthEntries?.map((candidate) => {
            const selected = displayedEntry?.uid === candidate.uid;
            const signed = statusFor(candidate) === 'signed';
            const rowConflict = monthConflictDates.has(candidate.date);
            const className = [
              'desktop-days__item',
              selected && 'desktop-days__item--selected',
              signed && 'desktop-days__item--signed',
              rowConflict && 'desktop-days__item--conflict',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                type="button"
                className={className}
                key={candidate.uid}
                aria-pressed={selected}
                aria-current={selected ? 'page' : undefined}
                onClick={() => {
                  if (candidate.id !== undefined) navigate(`/preview/${candidate.id}`);
                }}
              >
                <span className="desktop-days__number" dir="ltr">
                  {candidate.date.slice(8, 10)}
                </span>
                <span className="desktop-days__copy">
                  <strong>{weekday(candidate.date, t)}</strong>
                  <span
                    className={[
                      'desktop-days__status',
                      signed && !rowConflict && 'desktop-days__status--signed',
                      rowConflict && 'desktop-days__status--conflict',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {rowConflict
                      ? t.syncConflictLabel
                      : signed
                        ? t.desktopStatusSigned
                        : t.desktopStatusDraft}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="desktop-days__all btn btn--sm"
          onClick={() => void navigateWithinProject('/?view=list')}
        >
          <Icon name="list" size={16} />
          {t.desktopAllPages}
        </button>
      </aside>

      <section className="desktop-document" aria-label={t.desktopPreviewLabel}>
        {previewEntry ? (
          <>
            <div className="desktop-document__toolbar">
              <div className="desktop-document__date">
                <Icon name="doc" size={17} />
                <h1>{formatLongDate(previewEntry.date, t)}</h1>
              </div>
              <button
                type="button"
                className="desktop-document__edit btn btn--sm"
                onClick={() => {
                  if (previewEntry.id !== undefined) navigate(`/entry/${previewEntry.id}`);
                }}
              >
                <Icon name="pen" size={16} />
                {t.edit}
              </button>
            </div>

            {conflict && (
              <div className="desktop-document__notice desktop-document__notice--warning" role="alert">
                <Icon name="warning" size={18} />
                <span>
                  <strong>{conflictTitle}</strong>
                  <span>{conflictBody}</span>
                </span>
              </div>
            )}

            <div className="desktop-document__stage">
              <SheetScaler>
                <SheetPreview
                  entry={previewEntry}
                  project={project}
                  companyLogo={logoDataUrl}
                  pages={pageCount}
                  themeId={themeId}
                />
                <PhotoSheet
                  entry={previewEntry}
                  project={project}
                  companyLogo={logoDataUrl}
                  pages={pageCount}
                  themeId={themeId}
                />
              </SheetScaler>
            </div>
          </>
        ) : (
          <div className="desktop-document__empty">
            <Icon name={visibleMonthEntries === undefined ? 'diary' : 'calendar'} size={34} />
            <strong>
              {visibleMonthEntries === undefined ? t.loading : t.desktopNoPagesTitle}
            </strong>
            {visibleMonthEntries !== undefined && <p>{t.desktopNoPagesBody}</p>}
          </div>
        )}
      </section>

      <aside className="desktop-inspector" aria-label={t.desktopInspectorLabel}>
        <section className="desktop-inspector__section">
          <h2>{t.desktopYourDocument}</h2>
          <p className="desktop-inspector__hint">{t.desktopA4Hint}</p>
          <dl className="desktop-inspector__meta">
            <div className="desktop-inspector__row">
              <dt>{t.desktopPhotos}</dt>
              <dd>{t.desktopPhotoCount(previewEntry?.photos.length ?? 0)}</dd>
            </div>
            <div className="desktop-inspector__row">
              <dt>{t.language}</dt>
              <dd>{t.languageName}</dd>
            </div>
            <div className="desktop-inspector__row">
              <dt>{t.desktopStorage}</dt>
              <dd>
                {previewEntry ? (
                  <>
                    <Icon name="check" size={14} />
                    {t.desktopSavedLocally}
                  </>
                ) : (
                  t.desktopChooseDay
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section className="desktop-inspector__section desktop-inspector__section--export">
          <h2>{t.desktopFileFormat}</h2>
          <div
            className="desktop-inspector__formats"
            role="group"
            aria-label={t.desktopFileFormat}
          >
            {([
              ['pdf', 'PDF'],
              ['word', 'Word'],
              ['image', t.desktopFormatImage],
            ] as const).map(([value, label]) => (
              <button
                type="button"
                className={[
                  'desktop-inspector__format',
                  'btn',
                  'btn--sm',
                  format === value && 'desktop-inspector__format--selected',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-pressed={format === value}
                disabled={busy !== null}
                key={value}
                onClick={() => setFormat(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="desktop-inspector__deliver btn btn--primary"
            disabled={!previewEntry || conflict || conflictLoading || busy !== null}
            onClick={() => void runExport(format, canShare ? 'share' : 'save')}
          >
            <Icon name={canShare ? 'share' : 'download'} size={17} />
            {primaryBusy
              ? canShare
                ? t.sharing
                : t.generating
              : canShare
                ? t.desktopDeliverDocument
                : t.desktopCreateDocument}
          </button>
          {canShare && (
            <button
              type="button"
              className="desktop-inspector__save btn btn--sm"
              disabled={!previewEntry || conflict || conflictLoading || busy !== null}
              onClick={() => void runExport(format, 'save')}
            >
              <Icon name="download" size={16} />
              {busy?.deliver === 'save' ? t.generating : t.desktopSaveCopy}
            </button>
          )}
          {error && (
            <p className="desktop-inspector__error" role="status" aria-live="polite">
              {error}
            </p>
          )}
          {conflict && <p className="desktop-inspector__error">{t.desktopConflictExportBody}</p>}
        </section>

        <section className="desktop-inspector__reports desktop-inspector__note">
          <Icon name="reports" size={20} />
          <strong>{t.desktopReportsQuestion}</strong>
          <p>{t.desktopReportsHint}</p>
          <button
            type="button"
            className="desktop-inspector__reports-button btn btn--sm"
            onClick={() => void navigateWithinProject('/reports')}
          >
            {t.desktopOpenReports}
          </button>
        </section>
      </aside>
    </div>
  );
}
