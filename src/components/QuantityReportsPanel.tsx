import { useMemo, useState } from 'react';
import type { DiaryEntry, Project } from '../types';
import { useLanguage } from '../i18n/useLanguage';
import { useToast } from '../hooks/toastContext';
import { useContacts } from '../hooks/useData';
import { navigate } from '../hooks/useRoute';
import { quantityIssueText, quantityReports, quantityTotalLabel } from '../lib/quantityReport';
import { formatDdMmYyyy } from '../lib/dates';
import { canShareFiles } from '../lib/save';
import { Card, Field } from './ui';
import { Icon } from './Icon';
import '../styles/quantityReports.css';

/** One selected material or identified contractor, with every contributing source. */
export function QuantityReportsPanel({ entries, project, from, to, logoDataUrl, busy, onBusy }: {
  entries: DiaryEntry[]; project: Project; from: string; to: string;
  logoDataUrl?: string; busy: boolean; onBusy: (busy: boolean) => void;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const contacts = useContacts() ?? [];
  const reports = useMemo(() => quantityReports(entries, project.uid, from, to, t), [entries, project.uid, from, to, t]);
  const [choice, setChoice] = useState('concrete');
  const [working, setWorking] = useState(false);
  const report = reports.find(item => item.id === choice);
  const hasContent = !!report && (report.rows.length > 0 || report.issues.length > 0);
  const unassigned = report?.kind === 'contractor' && !report.contractorUid;
  const optionLabel = (id: string) => {
    const item = reports.find(row => row.id === id)!;
    if (reports.filter(row => row.title === item.title).length < 2) return item.title;
    const contact = contacts.find(row => row.uid === item.contractorUid);
    const context = [contact?.trade, contact?.phone, item.contractorUid?.slice(-6)].filter(Boolean).join(' · ');
    return `${item.title} · ${context}`;
  };
  const exportReport = async (format: 'pdf' | 'excel', share = false) => {
    if (busy || working || !report || !hasContent || (share && unassigned)) return;
    setWorking(true);
    onBusy(true);
    try {
      const { exportQuantityReport } = await import('../lib/exportQuantityReport');
      const name = await exportQuantityReport(report, project, from, to, format, { logoDataUrl, deliver: share ? 'share' : 'save' });
      if (name) toast.show(t.fileCreated(name));
    } catch {
      toast.error(t.reportFailed);
    } finally {
      setWorking(false);
      onBusy(false);
    }
  };
  return (
    <Card title={t.quantityReportsTitle}>
      <div className="quantity-reports">
        <p className="card__note">{t.quantityReportsHint}</p>
        <Field label={t.quantityReportSelection}>
          <select value={choice} onChange={event => setChoice(event.target.value)} disabled={busy}>
            {!report && <option value={choice} disabled>{t.quantityNoData}</option>}
            {reports.map(item => <option key={item.id} value={item.id}>{optionLabel(item.id)}</option>)}
          </select>
        </Field>
        {report && <>
          <div className="quantity-report-total" aria-live="polite">
            <span>{quantityTotalLabel(report, t)}</span>
            <strong><bdi dir="ltr">{report.totals.known ?? '—'}</bdi> <span>{report.totals.known === null ? '' : report.unit}</span></strong>
            <span className="muted small">{t.quantityCountedRows}: <bdi dir="ltr">{report.totals.countedRows} / {report.totals.sourceRows}</bdi></span>
          </div>
          {!hasContent && <p className="muted">{t.quantityNoData}</p>}
          <p className="muted small">{report.kind === 'contractor' ? t.quantityLaborRule : t.quantityMaterialRule}</p>
          <div className="btn-row">
            <button type="button" className="btn quantity-primary" disabled={busy || !hasContent} onClick={() => void exportReport('pdf')}>
              <Icon name="download" size={17} />{working ? t.generating : t.exportPdf}
            </button>
            <button type="button" className="btn" disabled={busy || !hasContent} onClick={() => void exportReport('excel')}>
              <Icon name="sheet" size={17} />{t.exportExcel}
            </button>
            {canShareFiles() && <button type="button" className="btn" disabled={busy || !hasContent || unassigned} onClick={() => void exportReport('pdf', true)}>
              <Icon name="share" size={17} />{t.shareButton}
            </button>}
          </div>
          {report.issues.length > 0 && <details className="quantity-review" open>
            <summary>{t.quantityIssues} · {report.issues.length}</summary>
            <ul>{report.issues.map((issue, i) => <li key={`${issue.entryUid}:${issue.rowId ?? ''}:${issue.code}:${i}`}>
              <span><bdi dir="ltr">{formatDdMmYyyy(issue.date)}</bdi> · {quantityIssueText(issue.code, t)}</span>
              {issue.entryId !== undefined && <button type="button" className="btn btn--ghost" onClick={() => navigate(`/entry/${issue.entryId}`)}>{t.quantityOpenDay}</button>}
            </li>)}</ul>
          </details>}
          {report.dailyTotals.length > 0 && <div className="quantity-daily">
            <h3>{t.summaryDailyDetails}</h3>
            <table>
              <thead><tr><th scope="col">{t.labelDate}</th><th scope="col">{report.kind === 'contractor' ? t.quantityDailyWorkers : t.labelQty}</th></tr></thead>
              <tbody>{report.dailyTotals.map(day => <tr key={day.date}><td><bdi dir="ltr">{formatDdMmYyyy(day.date)}</bdi></td><td><bdi dir="ltr">{day.value}</bdi> {report.dailyUnit}</td></tr>)}</tbody>
            </table>
          </div>}
          {report.rows.length > 0 && <details className="quantity-sources">
            <summary>{t.quantitySourceRows} · {report.rows.length}</summary>
            {report.rows.map(row => <details key={row.id} className="quantity-source">
              <summary><bdi dir="ltr">{formatDdMmYyyy(row.date)}</bdi> · {row.included ? `${row.value} ${report.dailyUnit}` : t.quantityExcluded}</summary>
              <dl>{row.fields.map((field, index) => <div key={index}><dt>{field.label}</dt><dd>{field.value || '—'}</dd></div>)}</dl>
              {row.entryId !== undefined && <button type="button" className="btn btn--ghost" onClick={() => navigate(`/entry/${row.entryId}`)}>{t.quantityOpenDay}</button>}
            </details>)}
          </details>}
        </>}
      </div>
    </Card>
  );
}
