/**
 * The combined report, on screen, before it is generated.
 *
 * The single-day preview has always existed; a range report did not have one,
 * so the only way to see what a month would produce was to produce it. That is
 * the slow operation in this app — every page and every photo in one file — and
 * getting the date range wrong meant waiting for a document only to throw it
 * away.
 *
 * It shows the same day sheets the report is built from, so what is on screen
 * is what comes out. It stops short of drawing the summary cover page: that
 * belongs to the PDF builder, and a second HTML copy of it would be a fourth
 * renderer to keep in step with the other three.
 */
import { useEffect, useMemo, useState } from 'react';
import type { DiaryEntry, Project } from '../types';
import { entriesInRange } from '../db';
import { formatDdMmYyyy } from '../lib/dates';
import { useCompanyLogo } from '../hooks/useBranding';
import { useDocThemeId } from '../hooks/useDocTheme';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { navigate } from '../hooks/useRoute';
import { PhotoSheet, SheetPreview } from '../components/SheetPreview';
import { SheetScaler } from '../components/SheetScaler';
import { EmptyState } from '../components/ui';
import { canShareFiles } from '../lib/save';

/**
 * How many days are drawn.
 *
 * Each sheet is a full A4 of live DOM, and a quarter's report is ninety of
 * them. The cap keeps the screen responsive on a phone; the report itself is
 * never truncated, and the heading says how many of the days are shown.
 */
const MAX_SHEETS = 12;

export function ReportPreviewScreen({
  project,
  from,
  to,
  includePhotos,
  includeSummary,
}: {
  project: Project;
  from: string;
  to: string;
  includePhotos: boolean;
  includeSummary: boolean;
}) {
  const logoDataUrl = useCompanyLogo();
  const themeId = useDocThemeId();
  const toast = useToast();
  const { t } = useLanguage();
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'share' | null>(null);

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

  const canShare = useMemo(() => canShareFiles(), []);
  const shown = useMemo(() => (entries ?? []).slice(0, MAX_SHEETS), [entries]);

  const build = async (deliver: 'save' | 'share') => {
    if (!entries?.length) return;
    setBusy(deliver === 'share' ? 'share' : 'pdf');
    try {
      const { exportRangePdf } = await import('../pdf/export');
      const name = await exportRangePdf(entries, project, from, to, {
        includePhotos,
        includeSummary,
        logoDataUrl,
        deliver,
      });
      if (deliver === 'save' && name) toast.show(t.fileCreated(name));
    } catch {
      toast.error(t.reportFailed);
    } finally {
      setBusy(null);
    }
  };

  if (!entries) return <p className="muted">{t.loading}</p>;

  return (
    <div>
      <div className="preview-toolbar">
        <button type="button" className="btn btn--sm" onClick={() => navigate('/reports')}>
          → {t.backToReports}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={busy !== null || entries.length === 0}
          onClick={() => void build('save')}
        >
          {busy === 'pdf' ? t.generating : `⬇ ${t.exportPdf}`}
        </button>
        {canShare && (
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy !== null || entries.length === 0}
            onClick={() => void build('share')}
          >
            {busy === 'share' ? t.sharing : `↗ ${t.shareButton}`}
          </button>
        )}
      </div>

      <div className="row row--wrap" style={{ marginBottom: 12 }}>
        <div className="grow">
          <h1 style={{ marginBottom: 2 }}>{t.reportPreviewTitle}</h1>
          <p className="muted small">
            {formatDdMmYyyy(from)} — {formatDdMmYyyy(to)} · {t.daysCount(entries.length)}
            {entries.length > shown.length && ` · ${t.reportPreviewOf(shown.length, entries.length)}`}
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState icon="🗓️" title={t.noEntriesInRange} />
      ) : (
        <SheetScaler>
          {shown.map((entry) => (
            <div key={entry.id ?? entry.uid}>
              <SheetPreview
                entry={entry}
                project={project}
                companyLogo={logoDataUrl}
                pages={includePhotos && entry.photos.length > 0 ? 2 : 1}
                themeId={themeId}
              />
              {includePhotos && entry.photos.length > 0 && (
                <PhotoSheet
                  entry={entry}
                  project={project}
                  companyLogo={logoDataUrl}
                  pages={2}
                  themeId={themeId}
                />
              )}
            </div>
          ))}
        </SheetScaler>
      )}
    </div>
  );
}
