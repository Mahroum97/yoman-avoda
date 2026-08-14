/**
 * ספקים וקבלנים as a printed list.
 *
 * The one document in this app that is not the printed form — it exists to be
 * pinned up in the site office, so it is a plain table with the six columns and
 * nothing else. It borrows the header band, the footer and the palette from the
 * diary pages so a company's paperwork looks like one set.
 *
 * Rows are measured before anything is drawn. A note can run to three lines and
 * a name to two, so a row's height is not known until its cells are wrapped —
 * and the page count printed in every header is not known until every row has
 * been measured. Hence two passes: measure, then paginate, then draw.
 */
import type { PDFDocument } from 'pdf-lib';
import type { Contact } from '../types';
import type { Strings } from '../i18n/strings';
import { Painter, type Fonts } from './painter';
import { drawFooter, drawHeaderBand, type PageChrome } from './entryPage';
import { CONTENT_W, METRICS, PAGE, TYPE, axisFor } from './theme';

const LEFT = PAGE.margin;
const RIGHT = PAGE.margin + CONTENT_W;

/** Fractions of the content width, in reading order from the start edge. */
const COLUMN_RATIOS = [0.055, 0.2, 0.145, 0.15, 0.19, 0.26];

/** A cell never grows past this; a note longer than three lines is clipped. */
const MAX_LINES = 3;
const LINE = 11;
const CELL_PAD = 5;
/** Comfortable minimum so a row of short values still reads as a row. */
const MIN_ROW = 20;

type Cells = [string, string, string, string, string, string];

interface Measured {
  cells: Cells;
  lines: string[][];
  height: number;
}

const columnWidths = (): number[] => COLUMN_RATIOS.map((r) => r * CONTENT_W);

/** Where a column starts, measured from the start edge. */
const columnOffsets = (widths: number[]): number[] => {
  const offsets: number[] = [];
  let run = 0;
  for (const w of widths) {
    offsets.push(run);
    run += w;
  }
  return offsets;
};

function measure(p: Painter, contacts: Contact[], t: Strings): Measured[] {
  const widths = columnWidths();
  return contacts.map((contact, index) => {
    const cells: Cells = [
      String(index + 1),
      contact.name || t.unnamedContact,
      contact.trade,
      contact.phone,
      contact.projects,
      contact.notes,
    ];
    const lines = cells.map((text, column) =>
      p.wrap(text, widths[column] - CELL_PAD * 2, { size: TYPE.cell }).slice(0, MAX_LINES),
    );
    const tallest = Math.max(1, ...lines.map((l) => l.length));
    return { cells, lines, height: Math.max(MIN_ROW, tallest * LINE + 8) };
  });
}

function drawHeaderRow(p: Painter, t: Strings, top: number): number {
  const a = axisFor(p.dir);
  const widths = columnWidths();
  const offsets = columnOffsets(widths);
  const h = METRICS.columnRow + 3;
  const titles = [
    t.contactNo,
    t.labelContactName,
    t.labelContactTrade,
    t.labelContactPhone,
    t.labelContactProjects,
    t.labelContactNotes,
  ];

  p.rect(LEFT, top, CONTENT_W, h, { fill: p.colors.tintHead });
  titles.forEach((title, column) => {
    const x = a.boxX(offsets[column], widths[column]);
    p.textCentreBox(title, x + widths[column] / 2, top, h, {
      size: TYPE.column,
      bold: true,
      color: p.colors.navy,
    });
    if (column > 0) {
      p.line(x + (a.dir === 'rtl' ? widths[column] : 0), top, x + (a.dir === 'rtl' ? widths[column] : 0), top + h, {
        color: p.colors.line,
        width: METRICS.hairline,
      });
    }
  });
  return top + h;
}

function drawRow(p: Painter, row: Measured, top: number, striped: boolean): number {
  const a = axisFor(p.dir);
  const widths = columnWidths();
  const offsets = columnOffsets(widths);

  if (striped) p.rect(LEFT, top, CONTENT_W, row.height, { fill: p.colors.tintRow });

  row.lines.forEach((lines, column) => {
    const x = a.boxX(offsets[column], widths[column]);
    // The serial number is centred; everything else reads from the start edge.
    const centred = column === 0;
    let y = top + (row.height - lines.length * LINE) / 2 + 1;
    for (const line of lines) {
      if (centred) {
        p.textCenter(line, x + widths[column] / 2, y, { size: TYPE.cell });
      } else {
        const start = a.dir === 'rtl' ? x + widths[column] - CELL_PAD : x + CELL_PAD;
        p.textStart(line, start, y, { size: TYPE.cell });
      }
      y += LINE;
    }
    if (column > 0) {
      const edge = x + (a.dir === 'rtl' ? widths[column] : 0);
      p.line(edge, top, edge, top + row.height, {
        color: p.colors.lineSoft,
        width: METRICS.hairline,
      });
    }
  });

  const bottom = top + row.height;
  p.line(LEFT, bottom, RIGHT, bottom, { color: p.colors.lineSoft, width: METRICS.hairline });
  return bottom;
}

export interface ContactsPageOptions {
  t: Strings;
  colors: PageChrome['colors'];
  logo?: PageChrome['logo'];
  generatedAt: Date;
  /** Printed under the title — the company the list belongs to. */
  owner?: string;
}

export function drawContactsDocument(
  doc: PDFDocument,
  fonts: Fonts,
  contacts: Contact[],
  options: ContactsPageOptions,
): void {
  const { t, colors, logo, generatedAt } = options;
  const newPage = () => doc.addPage([PAGE.width, PAGE.height]);

  // A painter with no page of its own, purely to measure text. Wrapping needs
  // the embedded fonts, and those belong to the document, not to a page.
  const ruler = new Painter(newPage(), fonts, t.dir, colors);
  const rows = measure(ruler, contacts, t);
  doc.removePage(doc.getPageCount() - 1);

  const bodyTop = PAGE.margin + METRICS.headerBand + METRICS.gap;
  const bodyBottom = PAGE.height - PAGE.margin - METRICS.footerBand - 4;

  // Pass one: which rows land on which page, so the header can say "1 of 3".
  const pages: Measured[][] = [];
  let current: Measured[] = [];
  let y = bodyTop + METRICS.columnRow + 3;
  for (const row of rows) {
    if (y + row.height > bodyBottom && current.length > 0) {
      pages.push(current);
      current = [];
      y = bodyTop + METRICS.columnRow + 3;
    }
    current.push(row);
    y += row.height;
  }
  pages.push(current);

  const owner = options.owner?.trim();
  pages.forEach((pageRows, index) => {
    const chrome: PageChrome = {
      pageNumber: index + 1,
      pageCount: pages.length,
      generatedAt,
      logo,
      t,
      colors,
    };
    const p = new Painter(newPage(), fonts, t.dir, colors);

    let top = drawHeaderBand(
      p,
      t.contactsTitle,
      owner || t.appName,
      t.contactsCount(contacts.length),
      chrome,
      PAGE.margin,
    );
    top += METRICS.gap;

    const tableTop = top;
    top = drawHeaderRow(p, t, top);
    pageRows.forEach((row, i) => {
      top = drawRow(p, row, top, i % 2 === 1);
    });
    p.rect(LEFT, tableTop, CONTENT_W, top - tableTop, {
      stroke: p.colors.line,
      lineWidth: METRICS.border,
    });

    if (contacts.length === 0) {
      p.textCenter(t.noContactsTitle, PAGE.width / 2, top + 30, {
        size: TYPE.section,
        color: p.colors.muted,
      });
    }

    drawFooter(p, { company: owner ?? '', name: t.contactsTitle }, chrome);
  });
}
