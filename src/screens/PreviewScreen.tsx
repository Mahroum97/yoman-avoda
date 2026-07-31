/**
 * Full-page preview of the form as it will be printed. Printing this screen
 * produces a PDF of the same layout, which is the app's PDF route.
 */
import { useState } from 'react';
import type { Project } from '../types';
import { useEntry } from '../hooks/useData';
import { useCompanyLogo } from '../hooks/useBranding';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { navigate } from '../hooks/useRoute';
import { PhotoSheet, SheetPreview } from '../components/SheetPreview';

export function PreviewScreen({
  entryId,
  project,
}: {
  entryId: number;
  project: Project;
}) {
  const entry = useEntry(entryId);
  const logoDataUrl = useCompanyLogo();
  const toast = useToast();
  const { t } = useLanguage();
  const [busy, setBusy] = useState<'pdf' | 'word' | null>(null);

  if (!entry) return <p className="muted">{t.loading}</p>;

  const pages = entry.photos.length > 0 ? 2 : 1;

  const downloadPdf = async () => {
    setBusy('pdf');
    try {
      const { exportEntryPdf } = await import('../pdf/export');
      const name = await exportEntryPdf(entry, project, { logoDataUrl });
      toast.show(t.fileCreated(name));
    } catch {
      toast.error(t.pdfFailed);
    } finally {
      setBusy(null);
    }
  };

  const downloadWord = async () => {
    setBusy('word');
    try {
      const { exportEntry } = await import('../docx/export');
      const name = await exportEntry(entry, project);
      toast.show(t.fileCreated(name));
    } catch {
      toast.error(t.wordFailed);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="preview-toolbar">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => navigate(`/entry/${entryId}`)}
        >
          → {t.back}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={busy !== null}
          onClick={() => void downloadPdf()}
        >
          {busy === 'pdf' ? t.generating : `⬇ ${t.exportPdf}`}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--brand"
          disabled={busy !== null}
          onClick={() => void downloadWord()}
        >
          {busy === 'word' ? t.exporting : t.exportWord}
        </button>
        <button type="button" className="btn btn--sm" onClick={() => window.print()}>
          🖨 {t.print}
        </button>
      </div>

      <div className="sheet-scroll">
        <SheetPreview
          entry={entry}
          project={project}
          companyLogo={logoDataUrl}
          pages={pages}
        />
        <PhotoSheet
          entry={entry}
          project={project}
          companyLogo={logoDataUrl}
          pages={pages}
        />
      </div>
    </div>
  );
}
