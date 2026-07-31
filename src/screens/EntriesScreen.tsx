/** The diary itself: every page of the active project, newest month first. */
import { useMemo, useState } from 'react';
import type { DiaryEntry, Project } from '../types';
import { duplicateForDate, findEntryByDate, saveEntry } from '../db';
import { formatDdMmYyyy, isoDate, monthKey, monthLabel, weekday } from '../lib/dates';
import { useEntries } from '../hooks/useData';
import { useCompanyLogo } from '../hooks/useBranding';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { navigate } from '../hooks/useRoute';
import { EmptyState, StatusChip } from '../components/ui';

export function EntriesScreen({ project }: { project: Project }) {
  const entries = useEntries(project.id);
  const logoDataUrl = useCompanyLogo();
  const toast = useToast();
  const { t } = useLanguage();
  const [query, setQuery] = useState('');

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

  const months = useMemo(() => {
    const map = new Map<string, DiaryEntry[]>();
    for (const entry of filtered) {
      const key = monthKey(entry.date);
      const list = map.get(key) ?? [];
      list.push(entry);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const today = isoDate();

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
    <div>
      <div className="row row--wrap" style={{ marginBottom: 14 }}>
        <div className="grow">
          <h1>{t.diaryTitle}</h1>
          <p className="muted small">{project.name}</p>
        </div>
      </div>

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

      {entries.length > 0 && filtered.length === 0 && (
        <EmptyState icon="🔍" title={t.noMatches} />
      )}

      {months.map(([key, list]) => (
        <div key={key}>
          <h2 className="month-heading">
            {monthLabel(list[0].date, t)} · {t.daysCount(list.length)}
          </h2>
          <div className="list">
            {list.map((entry) => {
              const workers = entry.contractors.reduce(
                (sum, row) => sum + (Number.parseInt(row.workers, 10) || 0),
                0,
              );
              return (
                <div className="entry" key={entry.id}>
                  <button
                    type="button"
                    className="entry__open"
                    onClick={() => navigate(`/entry/${entry.id}`)}
                  >
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
                          <span>🧱 {entry.casting.concreteQty} {t.unitCubicMetres}</span>
                        )}
                        {entry.photos.length > 0 && <span>📷 {entry.photos.length}</span>}
                      </span>
                    </span>
                  </button>
                  <StatusChip status={entry.status} />
                  <button
                    type="button"
                    className="btn btn--sm btn--icon"
                    aria-label={t.exportPdf}
                    title={t.exportPdf}
                    onClick={() => void quickExport(entry)}
                  >
                    ⬇
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
