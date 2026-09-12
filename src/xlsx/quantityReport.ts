/** Recalculable quantity report workbook with every selected source row. */
import type { Project } from '../types';
import type { Strings } from '../i18n/strings';
import {
  quantityIssueText,
  quantityTotalLabel,
  type QuantityReport,
  type QuantityReportRow,
} from '../lib/quantityReport';
import { exactToNumber } from '../lib/exactQuantity';
import { formatDdMmYyyy } from '../lib/dates';
import { buildWorkbook, type Cell, type FormulaCell } from './workbook';

const decimalPlaces = (value: string): number => value.split('.')[1]?.length ?? 0;

/** Safe Excel number where it can round-trip; exact text otherwise. */
const spreadsheetValue = (value: string): string | number => exactToNumber(value) ?? value;

function details(row: QuantityReportRow): string {
  return row.fields.map((field) => `${field.label}: ${field.value || '—'}`).join('\n');
}

export async function buildQuantityReportWorkbook(
  report: QuantityReport,
  project: Project,
  from: string,
  to: string,
  t: Strings,
): Promise<Blob> {
  const detailsName = t.summaryDailyDetails.slice(0, 31).replace(/[:\\/?*[\]]/g, ' ');
  const quotedDetails = `'${detailsName.replace(/'/g, "''")}'`;
  const detailRows: Cell[][] = [[
    t.labelDate,
    t.quantityIncluded,
    t.labelOriginalQuantity,
    t.detail,
    t.quantityKnownSubtotal,
    t.summaryParsedValue,
    report.unit,
    t.quantityIssues,
    t.detail,
  ]];

  for (const row of report.rows) {
    detailRows.push([
      formatDdMmYyyy(row.date),
      row.included ? t.quantityIncluded : t.quantityExcluded,
      row.rawQuantity,
      row.sourceUnit,
      row.included && row.value !== null ? spreadsheetValue(row.value) : null,
      row.value === null ? null : spreadsheetValue(row.value),
      report.dailyUnit,
      row.issueCodes.map((code) => quantityIssueText(code, t)).join('\n'),
      details(row),
    ]);
  }

  const counted = report.rows.filter((row) => row.included && row.value !== null);
  const exactTotal = report.totals.known;
  const totalNumber = exactTotal === null ? null : exactToNumber(exactTotal);
  const allNumeric = counted.every((row) => exactToNumber(row.value!) !== null);
  const precision = Math.max(0, ...counted.map((row) => decimalPlaces(row.value!)));
  let totalCell: Cell = t.quantityNoKnownTotal;
  if (exactTotal !== null) {
    if (totalNumber !== null && allNumeric && detailRows.length > 1) {
      totalCell = {
        formula: `ROUND(SUM(${quotedDetails}!E2:E${detailRows.length}),${precision})`,
        value: totalNumber,
      } satisfies FormulaCell;
    } else {
      totalCell = exactTotal;
    }
  }

  const summaryRows: Cell[][] = [
    [
      report.kind === 'contractor' && report.contractorName
        ? t.quantityExportTitle
        : report.title,
      '',
      '',
    ],
    [t.labelProjectName, project.name, ''],
    [t.labelCompany, project.company, ''],
    [t.docReportPeriod, `${formatDdMmYyyy(from)} — ${formatDdMmYyyy(to)}`, ''],
    [quantityTotalLabel(report, t), totalCell, report.unit],
    [t.quantitySourceRows, report.totals.sourceRows, ''],
    [t.quantityCountedRows, report.totals.countedRows, ''],
    [t.quantityIssues, report.totals.issueCount, ''],
    [report.kind === 'contractor' ? t.quantityLaborRule : t.quantityMaterialRule, '', ''],
    [],
    [t.summaryDailyDetails, t.summaryParsedValue, report.dailyUnit],
  ];
  if (report.kind === 'contractor' && report.contractorName) {
    // Keep the translated heading and raw name in different cells. A mixed
    // Hebrew/Arabic string can select a font that lacks half its glyphs.
    summaryRows.splice(3, 0, [t.labelContactName, report.contractorName, '']);
  }
  if (!report.dailyTotals.length) {
    summaryRows.push([
      report.totals.sourceRows === 0 ? t.quantityNoData : t.quantityNoKnownTotal,
      '',
      '',
    ]);
  } else {
    for (const day of report.dailyTotals) {
      const sourceRows = day.sourceRowIds
        .map((id) => report.rows.find((row) => row.id === id))
        .filter((row): row is QuantityReportRow => row !== undefined);
      const dayNumber = exactToNumber(day.value);
      const numericSources = sourceRows.every(
        (row) => row.value !== null && exactToNumber(row.value) !== null,
      );
      const precisionForDay = Math.max(
        0,
        ...sourceRows.map((row) => (row.value === null ? 0 : decimalPlaces(row.value))),
      );
      const summaryRow = summaryRows.length + 1;
      const value: Cell =
        dayNumber !== null && numericSources
          ? ({
              formula:
                `ROUND(SUMIF(${quotedDetails}!A$2:A$${detailRows.length},` +
                `A${summaryRow},${quotedDetails}!E$2:E$${detailRows.length}),${precisionForDay})`,
              value: dayNumber,
            } satisfies FormulaCell)
          : day.value;
      summaryRows.push([formatDdMmYyyy(day.date), value, report.dailyUnit]);
    }
  }
  if (report.issues.length) {
    summaryRows.push([], [t.quantityIssues, t.detail, '']);
    for (const issue of report.issues) {
      summaryRows.push([
        formatDdMmYyyy(issue.date),
        quantityIssueText(issue.code, t),
        issue.detail ?? '',
      ]);
    }
  }

  return buildWorkbook(
    [
      {
        name: t.xlsxSheetSummary,
        rows: summaryRows,
        widths: [48, 24, 18],
        headerRows: 1,
      },
      {
        name: detailsName,
        rows: detailRows,
        widths: [14, 14, 20, 14, 18, 18, 14, 45, 85],
        headerRows: 1,
      },
    ],
    t.dir === 'rtl',
  );
}
