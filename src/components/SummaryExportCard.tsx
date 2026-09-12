import { useMemo, useState } from 'react';
import type { DiaryEntry, Project } from '../types';
import { useLanguage } from '../i18n/useLanguage';
import { useToast } from '../hooks/toastContext';
import { summaryGroups, type SummaryScope } from '../lib/summaryReport';
import { canShareFiles } from '../lib/save';
import { Card, Field } from './ui';
import { Icon } from './Icon';

export function SummaryExportCard({ entries, project, from, to, logoDataUrl, busy, onBusy }: {
  entries: DiaryEntry[]; project: Project; from: string; to: string;
  logoDataUrl?: string; busy: boolean; onBusy: (busy: boolean) => void;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const [choice, setChoice] = useState<string>(() => summaryGroups(entries, t)[0]?.kind ?? '');
  const [working, setWorking] = useState(false);
  const groups = useMemo(() => summaryGroups(entries, t), [entries, t]);
  const options = useMemo(() => groups.map(group => ({
    key: group.kind, label: group.title, scope: { kind: group.kind } as SummaryScope,
  })), [groups]);
  // If a sync removed the selected item, require a new choice instead of
  // interpreting a missing item as "export the whole project".
  const selected = options.find(option => option.key === choice);
  const valid = !!selected;

  const download = async (format: 'pdf' | 'excel', share = false) => {
    if (busy || working || !valid) return;
    setWorking(true);
    onBusy(true);
    try {
      const { exportSummary } = await import('../lib/exportSummary');
      const name = await exportSummary(entries, project, from, to, format, {
        scope: selected?.scope, logoDataUrl, deliver: share ? 'share' : 'save',
      });
      if (name) toast.show(t.fileCreated(name));
    } catch {
      toast.error(t.reportFailed);
    } finally {
      setWorking(false);
      onBusy(false);
    }
  };
  if (!groups.length) return null;
  return (
    <Card title={t.summaryExport}>
      <p className="card__note">{t.summaryExportHint}</p>
      <Field label={t.periodSummary}>
        <select value={choice} onChange={event => setChoice(event.target.value)} disabled={busy}>
          {!valid && <option value={choice} disabled>{t.noEntriesInRange}</option>}
          {options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </Field>
      <div className="row" style={{ flexWrap: 'wrap', marginTop: 12 }}>
        <button type="button" className="btn btn--primary" disabled={busy || !valid} onClick={() => void download('pdf')}>
          <Icon name="download" size={17} /> {working ? t.generating : t.exportPdf}
        </button>
        <button type="button" className="btn" disabled={busy || !valid} onClick={() => void download('excel')}>
          <Icon name="sheet" size={17} /> {t.exportExcel}
        </button>
        {canShareFiles() && <button type="button" className="btn" disabled={busy || !valid} onClick={() => void download('pdf', true)}>
          <Icon name="share" size={17} /> {t.shareButton}
        </button>}
      </div>
    </Card>
  );
}
