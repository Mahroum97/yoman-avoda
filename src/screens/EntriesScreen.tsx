/** The diary itself: every page of the active project, as a list or a grid. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DiaryEntry, Project } from '../types';
import { deleteEntry, duplicateForDate, findEntryByDate, saveEntry } from '../db';
import { formatDdMmYyyy, isoDate, monthKey, monthLabel, weekday } from '../lib/dates';
import { useEntries } from '../hooks/useData';
import { useCompanyLogo } from '../hooks/useBranding';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { navigate } from '../hooks/useRoute';
import { logger } from '../lib/log';
import { EmptyState, StatusChip } from '../components/ui';
import { EntryTile } from '../components/EntryTile';
import { ViewMenu } from '../components/ViewMenu';
import type { SortKey, ViewMode } from '../components/viewOptions';

const log = logger('diary');

/*
 * How the diary is being looked at is a preference, not data: it belongs to the
 * device rather than the diary, so it stays in localStorage and never syncs.
 */
const VIEW_KEY = 'diaryView';
const SORT_KEY = 'diarySort';
const DIR_KEY = 'diarySortDesc';

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the choice still applies for this session */
  }
};

export function EntriesScreen({ project }: { project: Project }) {
  const entries = useEntries(project.id);
  const logoDataUrl = useCompanyLogo();
  const toast = useToast();
  const { t } = useLanguage();
  const [query, setQuery] = useState('');

  const [mode, setMode] = useState<ViewMode>(() => stored(VIEW_KEY, ['grid', 'list'] as const, 'list'));
  const [sort, setSort] = useState<SortKey>(() =>
    stored(SORT_KEY, ['date', 'updated', 'status'] as const, 'date'),
  );
  const [descending, setDescending] = useState(() => {
    try {
      return localStorage.getItem(DIR_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const setModeSticky = (next: ViewMode) => {
    setMode(next);
    remember(VIEW_KEY, next);
  };
  const setSortSticky = (next: SortKey) => {
    setSort(next);
    remember(SORT_KEY, next);
  };
  const setDirectionSticky = (next: boolean) => {
    setDescending(next);
    remember(DIR_KEY, String(next));
  };

  const filtered = useMemo(() => {
    if (!entries) return [];
    const needle = query.trim();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [
        entry.date,
        formatDdMmYyyy(entry.date),
        entry.weather,
        entry.workDescription,
        entry.supervisorNotes,
        entry.casting.description,
        ...entry.contractors.map((c) => c.trade),
        ...entry.management.map((m) => `${m.name} ${m.role}`),
        ...entry.equipment.map((e) => e.kind),
      ]
        .join(' ')
        .includes(needle),
    );
  }, [entries, query]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      if (sort === 'updated') return a.updatedAt - b.updatedAt;
      // Signed pages first when sorting by status, and within a status the
      // newest day — a bare status sort would leave the group in random order.
      if (sort === 'status') {
        const rank = (e: DiaryEntry) => (e.status === 'signed' ? 1 : 0);
        return rank(a) - rank(b) || a.date.localeCompare(b.date);
      }
      return a.date.localeCompare(b.date);
    });
    return descending ? rows.reverse() : rows;
  }, [filtered, sort, descending]);

  /* Month headings only make sense while the pages are in date order. */
  const grouped = sort === 'date';

  const months = useMemo(() => {
    if (!grouped) return [['', sorted] as [string, DiaryEntry[]]];
    const map = new Map<string, DiaryEntry[]>();
    for (const entry of sorted) {
      const key = monthKey(entry.date);
      const list = map.get(key) ?? [];
      list.push(entry);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [sorted, grouped]);

  const today = isoDate();

  /* ------------------------------------------------------------ selection */

  const leaveSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  // Leaving the screen mid-selection and coming back to a still-armed selection
  // bar would be a surprise, so it is dropped when the project changes.
  useEffect(() => {
    leaveSelection();
  }, [project.id, leaveSelection]);

  const toggle = (id: number) => {
    setSelected((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allIds = useMemo(
    () => sorted.map((entry) => entry.id).filter((id): id is number => id !== undefined),
    [sorted],
  );
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const removeSelected = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(t.confirmDeleteSelected(selected.size))) return;
    setBusy(true);
    try {
      for (const id of selected) await deleteEntry(id);
      log.info('deleted selected pages', { count: selected.size });
      toast.show(t.deletedSelected(selected.size));
      leaveSelection();
    } catch (error) {
      log.error('deleting selected pages failed', error);
      toast.error(t.pdfFailed);
    } finally {
      setBusy(false);
    }
  };

  /** A combined report of exactly the days that were picked. */
  const reportFromSelected = async () => {
    const picked = sorted.filter((entry) => entry.id !== undefined && selected.has(entry.id));
    if (picked.length === 0) {
      toast.error(t.selectNothing);
      return;
    }
    setBusy(true);
    try {
      const dates = picked.map((entry) => entry.date).sort();
      const { exportRangePdf } = await import('../pdf/export');
      const name = await exportRangePdf(
        // Oldest first: a report reads forwards even when the list does not.
        [...picked].sort((a, b) => a.date.localeCompare(b.date)),
        project,
        dates[0],
        dates[dates.length - 1],
        { logoDataUrl, includeSummary: true },
      );
      toast.show(t.fileCreated(name));
      leaveSelection();
    } catch (error) {
      log.error('report from selection failed', error);
      toast.error(t.reportFailed);
    } finally {
      setBusy(false);
    }
  };

  /* --------------------------------------------------------------- actions */

  const openToday = async () => {
    const existing = await findEntryByDate(project.id!, today);
    navigate(existing?.id ? `/entry/${existing.id}` : `/entry/new?date=${today}`);
  };

  /** Start tomorrow's page from today's crew — the common site workflow. */
  const repeatLast = async () => {
    const last = entries?.[0];
    if (!last) return;
    try {
      const copy = await duplicateForDate(last, today);
      const id = await saveEntry(copy);
      toast.show(t.entrySaved);
      navigate(`/entry/${id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.pdfFailed);
    }
  };

  const quickExport = async (entry: DiaryEntry) => {
    try {
      const { exportEntryPdf } = await import('../pdf/export');
      const name = await exportEntryPdf(entry, project, { logoDataUrl });
      toast.show(t.fileCreated(name));
    } catch {
      toast.error(t.pdfFailed);
    }
  };

  if (!entries) return <p className="muted">{t.loading}</p>;

  return (
    <div className={selecting ? 'has-selectionbar' : undefined}>
      <div className="row row--wrap" style={{ marginBottom: 14 }}>
        <div className="grow">
          <h1>{t.diaryTitle}</h1>
          <p className="muted small">{project.name}</p>
        </div>
        {entries.length > 0 && (
          <ViewMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            mode={mode}
            onModeChange={setModeSticky}
            sort={sort}
            onSortChange={setSortSticky}
            descending={descending}
            onDirectionChange={setDirectionSticky}
            onStartSelecting={() => setSelecting(true)}
          />
        )}
      </div>

      {!selecting && (
        <div className="btn-row" style={{ marginBottom: 16 }}>
          <button type="button" className="btn btn--primary" onClick={() => void openToday()}>
            ＋ {t.newToday}
          </button>
          {entries.length > 0 && !entries.some((e) => e.date === today) && (
            <button type="button" className="btn" onClick={() => void repeatLast()}>
              {t.duplicateLast}
            </button>
          )}
          <button type="button" className="btn" onClick={() => navigate('/reports')}>
            {t.combinedReport}
          </button>
        </div>
      )}

      {entries.length > 3 && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.searchPlaceholder}
          style={{ marginBottom: 16 }}
        />
      )}

      {entries.length === 0 && (
        <EmptyState icon="📋" title={t.noEntriesTitle}>
          <p className="muted">{t.noEntriesBody}</p>
        </EmptyState>
      )}

      {entries.length > 0 && filtered.length === 0 && <EmptyState icon="🔍" title={t.noMatches} />}

      {months.map(([key, list]) => (
        <div key={key || 'all'}>
          {grouped && (
            <h2 className="month-heading">
              {monthLabel(list[0].date, t)} · {t.daysCount(list.length)}
            </h2>
          )}

          {mode === 'grid' ? (
            <div className="tile-grid">
              {list.map((entry) => (
                <EntryTile
                  key={entry.id}
                  entry={entry}
                  selecting={selecting}
                  selected={entry.id !== undefined && selected.has(entry.id)}
                  onOpen={() => navigate(`/entry/${entry.id}`)}
                  onToggle={() => entry.id !== undefined && toggle(entry.id)}
                />
              ))}
            </div>
          ) : (
            <div className="list">
              {list.map((entry) => {
                const workers = entry.contractors.reduce(
                  (sum, row) => sum + (Number.parseInt(row.workers, 10) || 0),
                  0,
                );
                const isOn = entry.id !== undefined && selected.has(entry.id);
                return (
                  <div className={`entry${isOn ? ' entry--selected' : ''}`} key={entry.id}>
                    <button
                      type="button"
                      className="entry__open"
                      aria-pressed={selecting ? isOn : undefined}
                      onClick={() =>
                        selecting
                          ? entry.id !== undefined && toggle(entry.id)
                          : navigate(`/entry/${entry.id}`)
                      }
                    >
                      {selecting && (
                        <span className={`entry__check${isOn ? ' entry__check--on' : ''}`} aria-hidden="true">
                          {isOn ? '✓' : ''}
                        </span>
                      )}
                      <span className="entry__date">
                        <span className="entry__day">{entry.date.slice(8)}</span>
                        <span className="entry__month">{weekday(entry.date, t)}</span>
                      </span>
                      <span className="entry__body">
                        <span className="entry__title">
                          {entry.workDescription.split('\n')[0] || t.noDescription}
                        </span>
                        <span className="entry__meta">
                          {workers > 0 && <span>👷 {t.workersShort(workers)}</span>}
                          {entry.equipment.length > 0 && (
                            <span>🚜 {t.toolsShort(entry.equipment.length)}</span>
                          )}
                          {entry.casting.concreteQty && (
                            <span>
                              🧱 {entry.casting.concreteQty} {t.unitCubicMetres}
                            </span>
                          )}
                          {entry.photos.length > 0 && <span>📷 {entry.photos.length}</span>}
                        </span>
                      </span>
                    </button>
                    <StatusChip status={entry.status} />
                    {!selecting && (
                      <button
                        type="button"
                        className="btn btn--sm btn--icon"
                        aria-label={t.exportPdf}
                        title={t.exportPdf}
                        onClick={() => void quickExport(entry)}
                      >
                        ⬇
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {selecting && (
        <div className="selectionbar">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setSelected(allSelected ? new Set() : new Set(allIds))}
          >
            {allSelected ? t.selectNone : t.selectAll}
          </button>
          <span className="selectionbar__count">{t.selectedCount(selected.size)}</span>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            disabled={busy || selected.size === 0}
            onClick={() => void reportFromSelected()}
          >
            {t.reportFromSelected}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            disabled={busy || selected.size === 0}
            onClick={() => void removeSelected()}
          >
            {t.deleteSelected}
          </button>
          <button type="button" className="btn btn--sm" disabled={busy} onClick={leaveSelection}>
            {t.selectDone}
          </button>
        </div>
      )}
    </div>
  );
}
