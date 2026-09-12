/** Delivers one independently selected quantity report as PDF or Excel. */
import type { Project } from '../types';
import type { QuantityReport } from './quantityReport';
import { currentStrings } from '../i18n/useLanguage';
import {
  deliverBinary,
  deliverBlob,
  type Deliver,
  type ExportResult,
} from './save';
import { fileKind, logger } from './log';

const log = logger('quantity-export');

// File-system control characters are removed together with reserved punctuation.
// oxlint-disable-next-line no-control-regex
const safe = (value: string): string =>
  // oxlint-disable-next-line no-control-regex
  value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 65);

/** Compact stable disambiguator for two contacts that share the same name. */
const identityCode = (value: string): string => {
  let hash = 0x811c9dc5;
  for (const char of value) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export async function exportQuantityReport(
  report: QuantityReport,
  project: Project,
  from: string,
  to: string,
  format: 'pdf' | 'excel',
  options: { logoDataUrl?: string; deliver?: Deliver; themeId?: string } = {},
): Promise<ExportResult> {
  const t = currentStrings();
  const extension = format === 'pdf' ? 'pdf' : 'xlsx';
  const contractorCode = report.contractorUid ? `-${identityCode(report.contractorUid)}` : '';
  const name = `${safe(project.name)}-${safe(report.title)}${contractorCode}-${from}-${to}.${extension}`;

  try {
    let delivered: boolean;
    if (format === 'pdf') {
      const { buildQuantityReportPdf } = await import('../pdf/build');
      const bytes = await buildQuantityReportPdf(report, project, from, to, {
        strings: t,
        logoDataUrl: options.logoDataUrl,
        themeId: options.themeId ?? 'graphite',
      });
      delivered = await deliverBinary(bytes, name, 'application/pdf', options.deliver);
    } else {
      const { buildQuantityReportWorkbook } = await import('../xlsx/quantityReport');
      const workbook = await buildQuantityReportWorkbook(report, project, from, to, t);
      delivered = await deliverBlob(workbook, name, options.deliver);
    }
    log.info(delivered ? 'quantity report delivered' : 'quantity report delivery cancelled', {
      kind: fileKind(name),
      report: report.kind,
      rows: report.rows.length,
      counted: report.totals.countedRows,
      issues: report.totals.issueCount,
    });
    return delivered ? name : null;
  } catch (error) {
    log.error('quantity report export failed', error);
    throw error;
  }
}
