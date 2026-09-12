/** Selected report totals and their source values, with no unrelated diary data. */
import type { PDFDocument } from 'pdf-lib';
import type { Project } from '../types';
import type { SummaryGroup } from '../lib/summaryReport';
import { summaryTotalLabel } from '../lib/summaryReport';
import { formatDdMmYyyy } from '../lib/dates';
import { formatNum } from '../docx/summary';
import { Painter, type Fonts } from './painter';
import { drawFooter, drawHeaderBand, type PageChrome } from './entryPage';
import { CONTENT_W, METRICS, PAGE, TYPE, axisFor } from './theme';

interface Line { text: string; cells?: [string, string, string]; bold?: boolean; heading?: boolean; gap?: boolean }
const LINE_H = 15;
const TOP = PAGE.margin + METRICS.headerBand + METRICS.gap;
const BOTTOM = PAGE.height - PAGE.margin - METRICS.footerBand - 8;
const LINES_PER_PAGE = Math.floor((BOTTOM - TOP) / LINE_H);

export function drawSummaryReport(
  doc: PDFDocument, fonts: Fonts, groups: SummaryGroup[], project: Project,
  from: string, to: string, title: string, chrome: Omit<PageChrome, 'pageNumber' | 'pageCount'>,
): void {
  const t = chrome.t;
  const measurementPage = doc.addPage([PAGE.width, PAGE.height]);
  const ruler = new Painter(measurementPage, fonts, t.dir, chrome.colors);
  const lines: Line[] = [];
  const add = (text: string, style: Omit<Line, 'text'> = {}) => {
    // Split a single overlong token too: long pasted identifiers must stay in
    // the document instead of being silently ellipsized or crossing a border.
    for (const wrapped of ruler.wrap(text, CONTENT_W - 16, { size: TYPE.value, bold: style.bold })) {
      let part = '';
      for (const char of wrapped) {
        if (part && ruler.width(part + char, { size: TYPE.value, bold: style.bold }) > CONTENT_W - 16) {
          lines.push({ text: part, ...style });
          part = '';
        }
        part += char;
      }
      lines.push({ text: part, ...style });
    }
  };
  // Keep translated labels apart from user values. A Hebrew value next to
  // an Arabic label would otherwise select Cairo for both and lose Hebrew glyphs.
  add(t.labelCompany, { bold: true });
  add(project.company);
  add(t.labelAddress, { bold: true });
  add(project.address);
  add(t.summaryNumberRule);
  for (const group of groups) {
    lines.push({ text: '', gap: true });
    add(group.title, { heading: true, bold: true });
    lines.push({ text: '', cells: [t.detail, group.unit, t.unitDays], heading: true, bold: true });
    for (const row of group.totals) {
      lines.push({ text: '', cells: [row.label, formatNum(row.value), String(row.days)] });
    }
    add(summaryTotalLabel(group, t), { bold: true });
    add(t.summaryDailyDetails, { heading: true, bold: true });
    for (const row of group.sources) {
      add(`${formatDdMmYyyy(row.date)} · ${row.label}`, { bold: true });
      for (const [label, value] of row.fields) {
        add(label, { bold: true });
        add(value || '—');
      }
      add(`${t.summaryParsedValue}: ${formatNum(row.value)} ${group.unit}`);
      lines.push({ text: '', gap: true });
    }
  }
  doc.removePage(doc.getPageCount() - 1);

  // Plan every line before printing the first header. Long notes continue on
  // another page; the daily A4 form's fixed page budget does not apply here.
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
    const p = new Painter(doc.addPage([PAGE.width, PAGE.height]), fonts, t.dir, chrome.colors);
    const here: PageChrome = { ...chrome, pageNumber: index + 1, pageCount: pages.length };
    drawHeaderBand(p, title, project.name,
      `${formatDdMmYyyy(from)} — ${formatDdMmYyyy(to)}`, here, PAGE.margin);
    const axis = axisFor(t.dir);
    pageLines.forEach((line, i) => {
      const top = TOP + i * LINE_H;
      if (line.heading) p.rect(PAGE.margin, top, CONTENT_W, LINE_H, { fill: p.colors.tintHead });
      if (line.cells) {
        const widths = [CONTENT_W * 0.6, CONTENT_W * 0.25, CONTENT_W * 0.15];
        let offset = 0;
        line.cells.forEach((cell, column) => {
          const width = widths[column];
          p.textCentreBox(cell, axis.boxX(offset, width) + width / 2, top, LINE_H, {
            size: TYPE.value, bold: line.bold, maxWidth: width - 16,
          });
          offset += width;
        });
        p.line(PAGE.margin, top + LINE_H, PAGE.margin + CONTENT_W, top + LINE_H, {
          color: p.colors.lineSoft, width: METRICS.hairline,
        });
        return;
      }
      p.textStart(line.text, axis.boxX(8, 0), top + 1, {
        size: TYPE.value, bold: line.bold,
        color: line.heading ? p.colors.navy : p.colors.ink,
      });
    });
    drawFooter(p, project, here);
  });
}
