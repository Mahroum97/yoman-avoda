/** Professional received-quantity and contractor labor reports. */
import type { PDFDocument } from 'pdf-lib';
import type { Project } from '../types';
import {
  quantityIssueText,
  quantityTotalLabel,
  type QuantityReport,
} from '../lib/quantityReport';
import { formatDdMmYyyy } from '../lib/dates';
import { Painter, type Fonts } from './painter';
import { drawFooter, drawHeaderBand, type PageChrome } from './entryPage';
import { CONTENT_W, METRICS, PAGE, TYPE, axisFor } from './theme';

interface Line {
  text: string;
  cells?: string[];
  widths?: number[];
  bold?: boolean;
  heading?: boolean;
  gap?: boolean;
}

const LINE_H = 15;
const TOP = PAGE.margin + METRICS.headerBand + METRICS.gap;
const BOTTOM = PAGE.height - PAGE.margin - METRICS.footerBand - 8;
const LINES_PER_PAGE = Math.floor((BOTTOM - TOP) / LINE_H);

/** Adds wrapped lines without ever dropping a long pasted ticket or supplier id. */
function addWrapped(
  target: Line[],
  ruler: Painter,
  text: string,
  style: Omit<Line, 'text'> = {},
): void {
  const value = text || '—';
  for (const wrapped of ruler.wrap(value, CONTENT_W - 16, {
    size: TYPE.value,
    bold: style.bold,
  })) {
    let part = '';
    for (const char of wrapped) {
      if (
        part &&
        ruler.width(part + char, { size: TYPE.value, bold: style.bold }) > CONTENT_W - 16
      ) {
        target.push({ text: part, ...style });
        part = '';
      }
      part += char;
    }
    target.push({ text: part || '—', ...style });
  }
}

function plannedLines(
  report: QuantityReport,
  project: Project,
  ruler: Painter,
  chrome: Omit<PageChrome, 'pageNumber' | 'pageCount'>,
): Line[] {
  const { t } = chrome;
  const lines: Line[] = [];
  const add = (value: string, style: Omit<Line, 'text'> = {}) =>
    addWrapped(lines, ruler, value, style);
  const fact = (label: string, value: string) => {
    add(label, { bold: true });
    add(value);
  };

  fact(t.labelProjectName, project.name);
  fact(t.labelCompany, project.company);
  if (report.kind === 'contractor' && report.contractorName) {
    fact(t.labelContactName, report.contractorName);
  }
  fact(
    quantityTotalLabel(report, t),
    report.totals.known === null
      ? t.quantityNoKnownTotal
      : `${report.totals.known} ${report.unit}`,
  );
  fact(t.quantitySourceRows, String(report.totals.sourceRows));
  fact(t.quantityCountedRows, String(report.totals.countedRows));
  fact(t.quantityIssues, String(report.totals.issueCount));
  add(report.kind === 'contractor' ? t.quantityLaborRule : t.quantityMaterialRule);

  if (report.dailyTotals.length) {
    lines.push({ text: '', gap: true });
    add(t.summaryDailyDetails, { heading: true, bold: true });
    lines.push({
      text: '',
      cells: [t.labelDate, t.summaryParsedValue, report.dailyUnit],
      widths: [0.4, 0.35, 0.25],
      heading: true,
      bold: true,
    });
    for (const day of report.dailyTotals) {
      lines.push({
        text: '',
        cells: [formatDdMmYyyy(day.date), day.value, report.dailyUnit],
        widths: [0.4, 0.35, 0.25],
      });
    }
  }

  if (report.issues.length) {
    lines.push({ text: '', gap: true });
    add(t.quantityIssues, { heading: true, bold: true });
    for (const issue of report.issues) {
      add(`${formatDdMmYyyy(issue.date)} · ${quantityIssueText(issue.code, t)}`);
    }
  }

  lines.push({ text: '', gap: true });
  add(t.summaryDailyDetails, { heading: true, bold: true });
  if (!report.rows.length) add(t.quantityNoData);
  for (const row of report.rows) {
    add(
      `${formatDdMmYyyy(row.date)} · ${row.included ? t.quantityIncluded : t.quantityExcluded}`,
      { bold: true },
    );
    for (const field of row.fields) {
      add(field.label, { bold: true });
      add(field.value || '—');
    }
    add(t.summaryParsedValue, { bold: true });
    add(row.value === null ? '—' : `${row.value} ${report.dailyUnit}`);
    for (const code of row.issueCodes) add(quantityIssueText(code, t));
    lines.push({ text: '', gap: true });
  }
  return lines;
}

/** Plans all pages before drawing page 1, so every header has the right total. */
export function drawQuantityReport(
  doc: PDFDocument,
  fonts: Fonts,
  report: QuantityReport,
  project: Project,
  from: string,
  to: string,
  chrome: Omit<PageChrome, 'pageNumber' | 'pageCount'>,
): void {
  const measurement = doc.addPage([PAGE.width, PAGE.height]);
  const ruler = new Painter(measurement, fonts, chrome.t.dir, chrome.colors);
  const lines = plannedLines(report, project, ruler, chrome);
  doc.removePage(doc.getPageCount() - 1);

  const pages: Line[][] = [];
  let pending = [...lines];
  while (pending.length) {
    let count = Math.min(LINES_PER_PAGE, pending.length);
    while (count > 1 && pending[count - 1].heading) count -= 1;
    pages.push(pending.slice(0, count));
    pending = pending.slice(count);
  }
  if (!pages.length) pages.push([]);

  pages.forEach((pageLines, index) => {
    const p = new Painter(doc.addPage([PAGE.width, PAGE.height]), fonts, chrome.t.dir, chrome.colors);
    const here: PageChrome = {
      ...chrome,
      pageNumber: index + 1,
      pageCount: pages.length,
    };
    const title =
      report.kind === 'contractor' && report.contractorName
        ? chrome.t.quantityContractorLabor('').replace(/[\s\u2013\u2014-]+$/u, '')
        : report.title;
    drawHeaderBand(
      p,
      title,
      project.name,
      `${formatDdMmYyyy(from)} — ${formatDdMmYyyy(to)}`,
      here,
      PAGE.margin,
    );
    const axis = axisFor(chrome.t.dir);
    pageLines.forEach((line, lineIndex) => {
      const top = TOP + lineIndex * LINE_H;
      if (line.heading) {
        p.rect(PAGE.margin, top, CONTENT_W, LINE_H, { fill: p.colors.tintHead });
      }
      if (line.cells && line.widths) {
        let offset = 0;
        line.cells.forEach((cell, column) => {
          const width = CONTENT_W * line.widths![column];
          p.textCentreBox(cell, axis.boxX(offset, width) + width / 2, top, LINE_H, {
            size: TYPE.value,
            bold: line.bold,
            maxWidth: width - 12,
          });
          offset += width;
        });
        p.line(PAGE.margin, top + LINE_H, PAGE.margin + CONTENT_W, top + LINE_H, {
          color: p.colors.lineSoft,
          width: METRICS.hairline,
        });
      } else if (!line.gap) {
        p.textStart(line.text, axis.boxX(8, 0), top + 1, {
          size: TYPE.value,
          bold: line.bold,
          color: line.heading ? p.colors.navy : p.colors.ink,
          maxWidth: CONTENT_W - 16,
        });
      }
    });
    drawFooter(p, project, here);
  });
}
