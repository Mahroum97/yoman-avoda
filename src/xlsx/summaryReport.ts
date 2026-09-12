import type { DiaryEntry, Project } from '../types';
import type { Strings } from '../i18n/strings';
import { summaryGroups, sourceDetails, type SummaryScope } from '../lib/summaryReport';
import { formatDdMmYyyy } from '../lib/dates';
import { buildWorkbook, type Cell } from './workbook';
import { assertNoReportConflicts } from '../lib/reportConflicts';

/** The selected totals remain recalculable from the numeric daily source rows. */
export async function buildSummaryWorkbook(
  entries: DiaryEntry[], project: Project, from: string, to: string,
  t: Strings, scope?: SummaryScope,
): Promise<Blob> {
  assertNoReportConflicts(entries);
  const groups = summaryGroups(entries, t, scope);
  const detailsName = t.summaryDailyDetails.slice(0, 31).replace(/[:\\/?*[\]]/g, ' ');
  const quotedSheet = `'${detailsName.replace(/'/g, "''")}'`;
  const detailRows: Cell[][] = [[t.labelDate, t.periodSummary, t.detail, t.summaryParsedValue, t.detail]];
  const rows: Cell[][] = [
    [t.summaryExport, '', '', '', ''],
    [t.labelProjectName, project.name], [t.labelCompany, project.company],
    [t.docReportPeriod, `${formatDdMmYyyy(from)} — ${formatDdMmYyyy(to)}`],
    [t.summaryNumberRule], [],
    [t.periodSummary, t.detail, t.summaryParsedValue, t.unitDays, ''],
  ];
  for (const group of groups) {
    const first = detailRows.length + 1;
    detailRows.push(...group.sources.map(source => [
      formatDdMmYyyy(source.date), group.title, source.label, source.value, sourceDetails(source),
    ]));
    const last = detailRows.length;
    const firstTotal = rows.length + 1;
    for (const total of group.totals) {
      const rowNumber = rows.length + 1;
      // EXACT preserves case and treats * / ? literally, just like the Map
      // used by the app. SUMIF would silently combine "Crane" and "crane".
      rows.push([group.title, total.label, {
        formula: `SUMPRODUCT(--EXACT(${quotedSheet}!C${first}:C${last},B${rowNumber}),${quotedSheet}!D${first}:D${last})`,
        value: total.value,
      }, total.days, group.unit]);
    }
    const lastTotal = rows.length;
    rows.push([group.title, t.total, {
      formula: `SUM(C${firstTotal}:C${lastTotal})`,
      value: group.totals.reduce((sum, row) => sum + row.value, 0),
    }, null, group.unit]);
  }
  return buildWorkbook([
    { name: t.xlsxSheetSummary, rows, widths: [38, 32, 18, 12, 16], headerRows: 1 },
    { name: detailsName, rows: detailRows, widths: [14, 30, 28, 18, 75], headerRows: 1 },
  ], t.dir === 'rtl');
}
