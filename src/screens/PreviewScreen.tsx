/**
 * Full-page preview of the form as it will be printed. Printing this screen
 * produces a PDF of the same layout, which is the app's PDF route.
 */
import { useMemo, useState } from 'react';
import type { Project } from '../types';
import { useEntry } from '../hooks/useData';
import { useCompanyLogo } from '../hooks/useBranding';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { navigate } from '../hooks/useRoute';
import { useEscape } from '../hooks/useEscape';
import { PhotoSheet, SheetPreview } from '../components/SheetPreview';
import { SheetScaler } from '../components/SheetScaler';
import { canShareFiles, needsShareToPrint } from '../lib/save';
import { useDocThemeId } from '../hooks/useDocTheme';
import { Icon } from '../components/Icon';

export function PreviewScreen({
  entryId,
  project,
}: {
  entryId: number;
  project: Project;
}) {
  const entry = useEntry(entryId);
  const logoDataUrl = useCompanyLogo();
  const themeId = useDocThemeId();
  const toast = useToast();
  const { t } = useLanguage();
  const [busy, setBusy] = useState<'pdf' | 'word' | 'share' | null>(null);
  const canShare = useMemo(() => canShareFiles(), []);


  // Escape leaves the preview the same way the button beside it does.
  useEscape(() => navigate(`/entry/${entryId}`));
  if (!entry) return <p className="muted">{t.loading}</p>;

  const pages = entry.photos.length > 0 ? 2 : 1;

  const downloadPdf = async () => {
    setBusy('pdf');
    try {
      const { exportEntryPdf } = await import('../pdf/export');
      const name = await exportEntryPdf(entry, project, { logoDataUrl });
      if (name) toast.show(t.fileCreated(name));
    } catch {
      toast.error(t.pdfFailed);
    } finally {
      setBusy(null);
    }
  };

  /**
   * On a phone the print dialog does not exist, so printing means producing the
   * PDF and opening the share sheet, where the Print action lives.
   */
  const print = async () => {
    if (!needsShareToPrint()) {
      window.print();
      return;
    }
    setBusy('pdf');
    try {
      const { exportEntryPdf } = await import('../pdf/export');
      await exportEntryPdf(entry, project, { logoDataUrl });
    } catch {
      toast.error(t.pdfFailed);
    } finally {
      setBusy(null);
    }
  };

  /** The same PDF, straight into WhatsApp, Mail or AirDrop. */
  const share = async () => {
    setBusy('share');
    try {
      const { exportEntryPdf } = await import('../pdf/export');
      await exportEntryPdf(entry, project, { logoDataUrl, deliver: 'share' });
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
      if (name) toast.show(t.fileCreated(name));
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
          <Icon name="chevron" size={16} className="icon--back" />
          {t.back}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={busy !== null}
          onClick={() => void downloadPdf()}
        >
          {busy === 'pdf' ? (
            t.generating
          ) : (
            <>
              <Icon name="download" size={17} />
              {t.exportPdf}
            </>
          )}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--brand"
          disabled={busy !== null}
          onClick={() => void downloadWord()}
        >
          {busy === 'word' ? t.exporting : t.exportWord}
        </button>
        {canShare && (
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy !== null}
            onClick={() => void share()}
          >
            {busy === 'share' ? (
              t.sharing
            ) : (
              <>
                <Icon name="share" size={17} />
                {t.shareButton}
              </>
            )}
          </button>
        )}
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy !== null}
          onClick={() => void print()}
        >
          <Icon name="printer" size={17} />
          {t.print}
        </button>
      </div>

      <SheetScaler>
        <SheetPreview
          entry={entry}
          project={project}
          companyLogo={logoDataUrl}
          pages={pages}
          themeId={themeId}
        />
        <PhotoSheet
          entry={entry}
          project={project}
          companyLogo={logoDataUrl}
          pages={pages}
          themeId={themeId}
        />
      </SheetScaler>
    </div>
  );
}
