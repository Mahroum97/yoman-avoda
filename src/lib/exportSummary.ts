import type { DiaryEntry, Project } from '../types';
import { currentStrings } from '../i18n/useLanguage';
import { currentDocThemeId } from '../hooks/useDocTheme';
import { summaryGroups, summaryScopeName, type SummaryScope } from './summaryReport';
import { deliverBlob, deliverBinary, type Deliver, type ExportResult } from './save';
import { fileKind, logger } from './log';
import { assertNoReportConflicts } from './reportConflicts';

const log = logger('summary-export');

export async function exportSummary(
  entries: DiaryEntry[], project: Project, from: string, to: string,
  format: 'pdf' | 'excel', options: { scope?: SummaryScope; logoDataUrl?: string; deliver?: Deliver } = {},
): Promise<ExportResult> {
  assertNoReportConflicts(entries);
  const t = currentStrings();
  const groups = summaryGroups(entries, t, options.scope);
  if (!groups.length) return null;
  // File-system control characters are deliberately removed with reserved punctuation.
  // oxlint-disable-next-line no-control-regex
  const safe = (value: string) => value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 65);
  const name = `${safe(project.name)}-${safe(summaryScopeName(groups, t, options.scope))}-${from}-${to}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
  try {
    let delivered: boolean;
    if (format === 'pdf') {
      const { buildSummaryPdf } = await import('../pdf/build');
      const bytes = await buildSummaryPdf(entries, project, from, to, {
        strings: t, themeId: await currentDocThemeId(), scope: options.scope, logoDataUrl: options.logoDataUrl,
      });
      delivered = await deliverBinary(bytes, name, 'application/pdf', options.deliver);
    } else {
      const { buildSummaryWorkbook } = await import('../xlsx/summaryReport');
      delivered = await deliverBlob(await buildSummaryWorkbook(entries, project, from, to, t, options.scope), name, options.deliver);
    }
    log.info(delivered ? 'summary delivered' : 'summary delivery cancelled', { kind: fileKind(name), groups: groups.length });
    return delivered ? name : null;
  } catch (error) {
    log.error('summary export failed', error);
    throw error;
  }
}
