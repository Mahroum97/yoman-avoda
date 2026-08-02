/** Combined report over a period: summaries plus one page per diary day. */
import { useEffect, useMemo, useState } from 'react';
import type { DiaryEntry, Project } from '../types';
import { entriesInRange } from '../db';
import { formatDdMmYyyy, isoDate, monthRange } from '../lib/dates';
import { formatNum, summarise } from '../docx/summary';
import { useCompanyLogo } from '../hooks/useBranding';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { Card, EmptyState, Field } from '../components/ui';
import { navigate } from '../hooks/useRoute';
import { canShareFiles } from '../lib/save';

export function ReportsScreen({ project }: { project: Project }) {
  const toast = useToast();
  const { t } = useLanguage();
  const logoDataUrl = useCompanyLogo();
  const initial = useMemo(() => monthRange(isoDate()), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [includePhotos, setIncludePhotos] = useState(false);
  const [includeSummary, setIncludeSummary] = useState(true);
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'word' | 'excel' | 'share' | null>(null);
  const canShare = useMemo(() => canShareFiles(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (project.id === undefined || from > to) {
        setEntries([]);
        return;
      }
      const rows = await entriesInRange(project.id, from, to);
      if (!cancelled) setEntries(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id, from, to]);

  const stats = useMemo(() => (entries ? summarise(entries) : null), [entries]);

  const download = async (format: 'pdf' | 'word' | 'excel') => {
    if (!entries?.length) return;
    setBusy(format);
    try {
      const options = { includePhotos, includeSummary };
      let name: string;
      if (format === 'pdf') {
        name = await (await import('../pdf/export')).exportRangePdf(entries, project, from, to, {
          ...options,
          logoDataUrl,
        });
      } else if (format === 'word') {
        name = await (await import('../docx/export')).exportRange(entries, project, from, to, options);
      } else {
        // The spreadsheet ignores includePhotos and includeSummary: it always
        // carries both sheets, because a column is free and a photo cannot go
        // in one anyway.
        name = await (await import('../xlsx/export')).exportRangeXlsx(entries, project, from, to);
      }
      toast.show(t.fileCreated(name));
    } catch {
      toast.error(format === 'excel' ? t.excelFailed : t.reportFailed);
    } finally {
      setBusy(null);
    }
  };

  /** The finished report, handed to the share sheet instead of a save dialog. */
  const shareReport = async () => {
    if (!entries?.length) return;
    setBusy('share');
    try {
      const { exportRangePdf } = await import('../pdf/export');
      await exportRangePdf(entries, project, from, to, {
        includePhotos,
        includeSummary,
        logoDataUrl,
        deliver: 'share',
      });
    } catch {
      toast.error(t.reportFailed);
    } finally {
      setBusy(null);
    }
  };

  const openPreview = () => {
    const q = new URLSearchParams({
      from,
      to,
      photos: includePhotos ? '1' : '0',
      summary: includeSummary ? '1' : '0',
    });
    navigate(`/report-preview?${q.toString()}`);
  };

  const shiftMonth = (delta: number) => {
    const base = new Date(from);
    base.setMonth(base.getMonth() + delta);
    const range = monthRange(isoDate(base));
    setFrom(range.from);
    setTo(range.to);
  };

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>{t.reportsTitle}</h1>
      <p className="muted small" style={{ marginBottom: 16 }}>
        {project.name}
      </p>

      <Card title={t.period}>
        <div className="grid-2">
          <Field label={t.fromDate}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t.toDate}>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div className="month-jump">
          <button type="button" className="btn btn--sm" onClick={() => shiftMonth(-1)}>
            ← {t.prevMonth}
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              const range = monthRange(isoDate());
              setFrom(range.from);
              setTo(range.to);
            }}
          >
            {t.thisMonth}
          </button>
          <button type="button" className="btn btn--sm" onClick={() => shiftMonth(1)}>
            {t.nextMonth} →
          </button>
        </div>
        {from > to && <p className="card__note">{t.invalidRange}</p>}
      </Card>

      <Card title={t.reportContent}>
        <label className="row" style={{ marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={includeSummary}
            onChange={(e) => setIncludeSummary(e.target.checked)}
            style={{ width: 20, height: 20, minHeight: 0 }}
          />
          <span>{t.includeSummary}</span>
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={includePhotos}
            onChange={(e) => setIncludePhotos(e.target.checked)}
            style={{ width: 20, height: 20, minHeight: 0 }}
          />
          <span>{t.includePhotos}</span>
        </label>
      </Card>

      {stats && entries && (
        <Card title={t.periodSummary}>
          {entries.length === 0 ? (
            <EmptyState icon="🗓️" title={t.noEntriesInRange} />
          ) : (
            <>
              <div className="grid-2">
                <Stat label={t.statDiaryDays} value={String(stats.days)} />
                <Stat label={t.statActiveDays} value={String(stats.activeDays)} />
                <Stat label={t.statCastingDays} value={String(stats.castingDays)} />
                <Stat label={t.statConcreteTotal} value={formatNum(stats.concreteTotal)} />
                <Stat
                  label={t.statSigned}
                  value={`${stats.signedDays} / ${stats.days}`}
                />
                <Stat label={t.statPhotos} value={String(stats.photos)} />
              </div>

              <SummaryList title={t.summaryTrades} unit={t.unitWorkers} rows={stats.trades} unitDays={t.unitDays} />
              <SummaryList title={t.summaryEquipment} unit={t.unitHours} rows={stats.equipment} unitDays={t.unitDays} />
              <SummaryList title={t.summaryConcrete} unit={t.unitCubicMetres} rows={stats.concrete} unitDays={t.unitDays} />
            </>
          )}
        </Card>
      )}

      <div className="btn-row" style={{ marginBottom: 24 }}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy !== null || !entries?.length}
          onClick={() => void download('pdf')}
        >
          {busy === 'pdf' ? t.generating : `⬇ ${t.generateReportPdf(entries?.length ?? 0)}`}
        </button>
        <button
          type="button"
          className="btn btn--brand"
          disabled={busy !== null || !entries?.length}
          onClick={() => void download('word')}
        >
          {busy === 'word' ? t.exporting : t.exportWord}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy !== null || !entries?.length}
          onClick={() => void download('excel')}
        >
          {busy === 'excel' ? t.exporting : `▦ ${t.exportExcel}`}
        </button>
        {canShare && (
          <button
            type="button"
            className="btn"
            disabled={busy !== null || !entries?.length}
            onClick={() => void shareReport()}
          >
            {busy === 'share' ? t.sharing : `↗ ${t.shareButton}`}
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy !== null || !entries?.length}
          onClick={openPreview}
        >
          {t.previewButton}
        </button>
      </div>

      {entries && entries.length > 0 && (
        <p className="muted small" style={{ marginBottom: 32 }}>
          {t.reportCovers(
            formatDdMmYyyy(entries[0].date),
            formatDdMmYyyy(entries[entries.length - 1].date),
          )}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="muted small">{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function SummaryList({
  title,
  unit,
  rows,
  unitDays,
}: {
  title: string;
  unit: string;
  rows: { label: string; total: number; days: number }[];
  unitDays: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 18 }}>
      <h3 style={{ marginBottom: 8 }}>{title}</h3>
      <div className="stack" style={{ gap: 6 }}>
        {rows.map((row) => (
          <div className="row" key={row.label}>
            <span className="grow">{row.label}</span>
            <span className="chip">
              {formatNum(row.total)} {unit}
            </span>
            <span className="muted small">{row.days} {unitDays}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
