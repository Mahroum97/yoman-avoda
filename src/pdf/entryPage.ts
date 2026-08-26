/**
 * The diary page as a designed A4 document.
 *
 * Same structure as the printed form — an inspector reads it the same way — but
 * raised in quality: a navy header band carrying the logo, shaded section and
 * table headings, hairline rules instead of heavy black boxes, and a footer band
 * with the company, the generation time and the page number.
 *
 * Two things shape the layout:
 *  - The page is drawn top-down with a running `y` cursor, and the heights in
 *    METRICS are chosen so a full day fits on one sheet — the defect that made
 *    the browser-printed version spill onto a second page.
 *  - Positions are *logical*, measured from the edge the language starts at, and
 *    mapped to physical coordinates through `axis`. That is what lets the same
 *    code print a right-to-left Hebrew/Arabic page and a left-to-right English
 *    one.
 */
import type { PDFImage } from 'pdf-lib';
import type { DiaryEntry, Project } from '../types';
import type { Strings } from '../i18n/strings';
import { formatDdMmYyyy, formatLongDate } from '../lib/dates';
import { Painter } from './painter';
import type { Palette } from './theme';
import {
  CONTENT_W,
  CREW_COLUMNS,
  METRICS,
  PAGE,
  TYPE,
  axisFor,
  type Axis,
} from './theme';
import { CREW_BODY, crewRowHeight, crewTextSize } from '../lib/crewLayout';

const LEFT = PAGE.margin;
const RIGHT = PAGE.margin + CONTENT_W;

export interface PageChrome {
  /** Company logo, if the user uploaded one. */
  logo?: PDFImage;
  pageNumber: number;
  pageCount: number;
  generatedAt: Date;
  t: Strings;
  /** The document palette, so pages built here match the rest. */
  colors?: Palette;
}

const axisOf = (p: Painter): Axis => axisFor(p.dir);

/*
 * What the page spends before the crew rows get any of it: the margins, the
 * band, the panels, the two section bars, the table's own two heading rows, the
 * description block, the block of notes and signatures, and the gaps between
 * them. Whatever is left is `CREW_BODY`, and the rows divide it.
 */
const PAGE_WITHOUT_CREW_ROWS =
  PAGE.margin +
  METRICS.headerBand +
  METRICS.gap +
  METRICS.infoPanel +
  METRICS.gap +
  METRICS.sectionBar +
  METRICS.groupRow +
  METRICS.columnRow +
  METRICS.gap +
  METRICS.sectionBar +
  (METRICS.descriptionLines * METRICS.descriptionLine + 10) +
  METRICS.gap +
  (METRICS.signatureBox * 2 + 7);

const CREW_BODY_ACTUAL =
  PAGE.height - PAGE.margin - METRICS.footerBand - 8 - PAGE_WITHOUT_CREW_ROWS;

if (Math.abs(CREW_BODY_ACTUAL - CREW_BODY) > 1) {
  throw new Error(
    `the crew rows have ${CREW_BODY_ACTUAL.toFixed(1)}pt of page, CREW_BODY says ${CREW_BODY}`,
  );
}

/* ------------------------------------------------------------- header band */

export function drawHeaderBand(
  p: Painter,
  title: string,
  subtitle: string,
  detail: string,
  chrome: PageChrome,
  top: number,
): number {
  const a = axisOf(p);
  const h = METRICS.headerBand;
  p.rect(LEFT, top, CONTENT_W, h, { fill: p.colors.navy });
  // Amber rule along the bottom edge — the one splash of brand colour.
  p.rect(LEFT, top + h - 2.5, CONTENT_W, 2.5, { fill: p.colors.amber });

  const pad = 14;

  // The app mark sits on the starting edge, next to the title.
  const markSize = 22;
  const markX = a.boxX(pad, markSize);
  const markTop = top + (h - 2.5 - markSize) / 2;
  p.rect(markX, markTop, markSize, markSize, { fill: p.colors.amber });
  p.rect(markX + 4, markTop + 5, markSize - 8, markSize - 8, { fill: p.colors.white });
  for (let i = 0; i < 3; i += 1) {
    p.rect(markX + 6.5, markTop + 8 + i * 4, markSize - 13, 1.6, { fill: p.colors.navy });
  }

  const titleStart = a.dir === 'rtl' ? markX - 9 : markX + markSize + 9;
  // Half the band, so a long project name stops before the date and the logo
  // at the other end rather than printing over them.
  const headWidth = CONTENT_W / 2 - pad;
  p.textStart(title, titleStart, top + 12, {
    size: TYPE.title,
    bold: true,
    color: p.colors.white,
    maxWidth: headWidth,
  });
  p.textStart(subtitle, titleStart, top + 34, {
    size: TYPE.subtitle,
    color: p.colors.tintGroup,
    maxWidth: headWidth,
  });

  // Far end of the band: the date, the page number and the company logo.
  let endOffset = pad;
  if (chrome.logo) {
    const maxH = 30;
    const maxW = 78;
    const scale = Math.min(maxW / chrome.logo.width, maxH / chrome.logo.height);
    const w = chrome.logo.width * scale;
    const hh = chrome.logo.height * scale;
    const x = a.dir === 'rtl' ? LEFT + pad : RIGHT - pad - w;
    p.image(chrome.logo, x, top + (h - 2.5 - hh) / 2, w, hh);
    endOffset += w + 10;
  }

  const detailX = a.dir === 'rtl' ? LEFT + endOffset : RIGHT - endOffset;
  const drawEnd = (text: string, y: number, options: Parameters<Painter['text']>[3]) => {
    if (a.dir === 'rtl') p.text(text, detailX, y, options);
    else p.textRight(text, detailX, y, options);
  };
  drawEnd(detail, top + 14, { size: TYPE.subtitle, color: p.colors.white });
  drawEnd(chrome.t.docPage(chrome.pageNumber, chrome.pageCount), top + 34, {
    size: TYPE.label,
    color: p.colors.tintGroup,
  });

  return top + h;
}

/* ------------------------------------------------------------ footer band */

/**
 * The strip along the bottom of every page.
 *
 * Takes the two fields it actually prints rather than a whole `Project`, so the
 * contacts list — which belongs to no single site — can use the same footer as
 * the diary pages. A `Project` satisfies this shape as it stands.
 */
export function drawFooter(
  p: Painter,
  project: { company?: string; name?: string },
  chrome: PageChrome,
): void {
  const top = PAGE.height - PAGE.margin - METRICS.footerBand;
  p.line(LEFT, top, RIGHT, top, { color: p.colors.line, width: METRICS.hairline });

  const stamp = `${formatDdMmYyyy(chrome.generatedAt.toISOString().slice(0, 10))} ${chrome.generatedAt
    .toTimeString()
    .slice(0, 5)}`;
  const a = axisOf(p);
  const small = { size: TYPE.footer, color: p.colors.muted };

  p.textStart(project.company || project.name || '', a.startX, top + 5, {
    ...small,
    // A third of the strip: the stamp sits in the middle of it and the page
    // number at the far end, and a long company name reached both.
    maxWidth: CONTENT_W / 3,
  });
  p.textCenter(`${chrome.t.docGeneratedBy} · ${stamp}`, LEFT + CONTENT_W / 2, top + 5, small);
  if (a.dir === 'rtl') p.text(chrome.t.docPage(chrome.pageNumber, chrome.pageCount), LEFT, top + 5, small);
  else p.textRight(chrome.t.docPage(chrome.pageNumber, chrome.pageCount), RIGHT, top + 5, small);
}

/* -------------------------------------------------------------- section bar */

export function sectionBar(p: Painter, label: string, top: number): number {
  const a = axisOf(p);
  const h = METRICS.sectionBar;
  p.rect(LEFT, top, CONTENT_W, h, { fill: p.colors.tintHead });
  // Amber tick on the starting edge — reads as a bullet in either direction.
  p.rect(a.boxX(0, 3), top, 3, h, { fill: p.colors.amber });
  const textStart = a.dir === 'rtl' ? a.startX - 3 : a.startX + 3;
  p.textStartBox(label, textStart, top, h, {
    size: TYPE.section,
    bold: true,
    color: p.colors.navy,
    pad: 9,
  });
  return top + h;
}

/* -------------------------------------------------- project / date panels */

function labelledLines(
  p: Painter,
  lines: [string, string][],
  panelOffset: number,
  panelWidth: number,
  top: number,
): void {
  const a = axisOf(p);
  const inset = 10;
  const start = a.dir === 'rtl'
    ? a.boxX(panelOffset, panelWidth) + panelWidth - inset
    : a.boxX(panelOffset, panelWidth) + inset;
  const far = a.dir === 'rtl'
    ? a.boxX(panelOffset, panelWidth) + inset
    : a.boxX(panelOffset, panelWidth) + panelWidth - inset;

  let y = top;
  for (const [label, value] of lines) {
    const labelText = `${label}:`;
    p.textStart(labelText, start, y, {
      size: TYPE.label,
      bold: true,
      color: p.colors.navySoft,
    });
    const labelWidth = p.width(labelText, { size: TYPE.label, bold: true });
    const valueStart = a.dir === 'rtl' ? start - labelWidth - 6 : start + labelWidth + 6;
    p.textStart(value, valueStart, y - 0.5, {
      size: TYPE.value,
      color: p.colors.ink,
      // What is left of the panel once the label has taken its share: a long
      // company name has nowhere to go but out of the panel otherwise.
      maxWidth: panelWidth - inset * 2 - labelWidth - 6,
    });
    const [x1, x2] = a.dir === 'rtl' ? [far, valueStart] : [valueStart, far];
    p.line(x1, y + 11, x2, y + 11, { color: p.colors.lineSoft, width: METRICS.hairline });
    y += 17;
  }
}

function infoPanels(
  p: Painter,
  entry: DiaryEntry,
  project: Project,
  t: Strings,
  top: number,
): number {
  const a = axisOf(p);
  const h = METRICS.infoPanel;
  const gap = 8;
  const w = (CONTENT_W - gap) / 2;

  const panels: [string, number, [string, string][]][] = [
    [
      t.labelProject,
      0,
      [
        [t.labelProjectName, project.name],
        [t.labelAddress, project.address],
        [t.labelCompany, project.company],
      ],
    ],
    [
      t.labelDateWeather,
      w + gap,
      [
        [t.labelDate, formatLongDate(entry.date, t)],
        [t.labelWeather, entry.weather],
      ],
    ],
  ];

  for (const [heading, offset, lines] of panels) {
    const x = a.boxX(offset, w);
    p.rect(x, top, w, h, {
      fill: p.colors.panel,
      stroke: p.colors.line,
      lineWidth: METRICS.hairline,
    });
    p.textStart(heading, a.dir === 'rtl' ? x + w - 10 : x + 10, top + 7, {
      size: TYPE.group,
      bold: true,
      color: p.colors.navy,
    });
    p.line(x + 10, top + 20, x + w - 10, top + 20, {
      color: p.colors.line,
      width: METRICS.hairline,
    });
    labelledLines(p, lines, offset, w, top + 26);
  }

  return top + h;
}

/* ------------------------------------------------------------- crew table */

function crewTable(p: Painter, entry: DiaryEntry, t: Strings, top: number): number {
  const a = axisOf(p);

  // Column boxes in logical order: the first column sits at the start edge.
  const offsets: number[] = [];
  let run = 0;
  for (const width of CREW_COLUMNS) {
    offsets.push(run);
    run += width;
  }
  const centreOf = (i: number) => a.boxX(offsets[i], CREW_COLUMNS[i]) + CREW_COLUMNS[i] / 2;
  const spanCentre = (from: number, count: number) => {
    const width = CREW_COLUMNS.slice(from, from + count).reduce((s, w) => s + w, 0);
    return a.boxX(offsets[from], width) + width / 2;
  };

  let y = top;

  p.rect(LEFT, y, CONTENT_W, METRICS.groupRow, { fill: p.colors.tintGroup });
  const groups: [string, number, number][] = [
    [t.labelManagement, 0, 2],
    [t.labelContractor, 2, 2],
    [t.labelEquipment, 4, 3],
  ];
  for (const [label, from, count] of groups) {
    p.textCentreBox(label, spanCentre(from, count), y, METRICS.groupRow, {
      size: TYPE.group,
      bold: true,
      color: p.colors.navy,
    });
  }
  y += METRICS.groupRow;

  p.rect(LEFT, y, CONTENT_W, METRICS.columnRow, { fill: p.colors.tintHead });
  const headers = [
    t.labelName,
    t.labelRole,
    t.labelTrade,
    t.labelWorkers,
    t.labelKind,
    t.labelQty,
    t.labelHours,
  ];
  headers.forEach((label, i) => {
    p.textCentreBox(label, centreOf(i), y, METRICS.columnRow, {
      // The workers column is narrow; its label needs the smaller size.
      size: i === 3 ? TYPE.tiny : TYPE.column,
      bold: true,
      color: p.colors.navy,
      maxWidth: CREW_COLUMNS[i] - 4,
    });
  });
  y += METRICS.columnRow;

  const rowCount = Math.max(
    METRICS.minCrewRows,
    entry.management.length,
    entry.contractors.length,
    entry.equipment.length,
  );

  // The rows share what the page leaves them: nothing changes for a normal day,
  // and a day with a dozen trades tightens rather than pushing the signatures
  // off the bottom of the sheet.
  const rowH = crewRowHeight(rowCount);
  const cellSize = crewTextSize(rowH, TYPE.cell);

  const bodyTop = y;
  for (let i = 0; i < rowCount; i += 1) {
    if (i % 2 === 1) p.rect(LEFT, y, CONTENT_W, rowH, { fill: p.colors.tintRow });
    const staff = entry.management[i];
    const contractor = entry.contractors[i];
    const equipment = entry.equipment[i];
    const values = [
      staff?.name ?? '',
      staff?.role ?? '',
      contractor?.trade ?? '',
      contractor?.workers ?? '',
      equipment?.kind ?? '',
      equipment?.qty ?? '',
      equipment?.hours ?? '',
    ];
    values.forEach((value, col) => {
      // Bounded by its own column: a trade typed longer than the box is what
      // used to print across the rule and into the column beside it.
      p.textCellBox(value, centreOf(col), y, rowH, CREW_COLUMNS[col] - 6, {
        size: cellSize,
      });
    });
    y += rowH;
    p.line(LEFT, y, RIGHT, y, { color: p.colors.lineSoft, width: METRICS.hairline });
  }

  /*
   * Columns inside a group are separated by a hairline; the two boundaries
   * *between* the groups get a full rule, so management, contractor and
   * equipment read as three blocks rather than one seven-column run.
   */
  const groupEdges = new Set([2, 4]);
  for (let i = 1; i < CREW_COLUMNS.length; i += 1) {
    const gx = a.boxX(offsets[i], CREW_COLUMNS[i]);
    const edge = a.dir === 'rtl' ? gx + CREW_COLUMNS[i] : gx;
    const isGroupEdge = groupEdges.has(i);
    p.line(edge, top, edge, y, {
      color: isGroupEdge ? p.colors.muted : p.colors.line,
      width: isGroupEdge ? METRICS.border : METRICS.hairline,
    });
  }
  p.line(LEFT, bodyTop, RIGHT, bodyTop, { color: p.colors.line, width: METRICS.hairline });
  p.rect(LEFT, top, CONTENT_W, y - top, { stroke: p.colors.line, lineWidth: METRICS.border });

  return y;
}

/* ------------------------------------------------------ ruled writing areas */

/** Smaller than this and the writing stops being writing. */
const RULED_MIN_SIZE = 5.5;

/**
 * The user's text into one of the form's ruled areas, all of it.
 *
 * The rules are drawn by the caller and never move — they are the form. What
 * moves is the text: if it wraps to more lines than there are rules it is set
 * smaller and tighter until the whole of it fits between the first rule and the
 * last. Before this the loop simply stopped at the last rule, so a long day's
 * description printed as much as fitted and **silently dropped the rest** —
 * the one thing a diary must not do to the sentence someone wrote in it.
 *
 * Text that fits is left exactly where it was: sitting on the rules, at the
 * size the form is set in.
 */
function ruledText(
  p: Painter,
  text: string,
  options: {
    /** The edge the language starts at. */
    start: number;
    top: number;
    width: number;
    /** How many rules the area has, and how far apart they are. */
    rules: number;
    pitch: number;
    size: number;
  },
): void {
  if (!text.trim()) return;
  const { start, top, width, rules, pitch, size } = options;
  const room = rules * pitch;

  let lines = p.wrap(text, width, { size: TYPE.note });
  let fontSize = size;
  let step = pitch;

  if (lines.length > rules) {
    // Down in quarter points: the first size whose wrapped text fits the same
    // height, and failing that the smallest one, with what is left of the text
    // marked as cut rather than quietly absent.
    for (let trial = size - 0.25; trial >= RULED_MIN_SIZE; trial -= 0.25) {
      const wrapped = p.wrap(text, width, { size: trial });
      if (wrapped.length * (trial + 2.2) <= room) {
        lines = wrapped;
        fontSize = trial;
        break;
      }
      lines = wrapped;
      fontSize = trial;
    }
    const fits = Math.max(1, Math.floor(room / (fontSize + 2.2)));
    if (lines.length > fits) {
      lines = lines.slice(0, fits);
      lines[fits - 1] = `${lines[fits - 1]}…`;
    }
    step = room / lines.length;
  }

  let y = top;
  for (const line of lines) {
    p.textStart(line, start, y, { size: fontSize });
    y += step;
  }
}

/* --------------------------------------------- description + casting box */

function castingBox(
  p: Painter,
  entry: DiaryEntry,
  t: Strings,
  offset: number,
  w: number,
  top: number,
  h: number,
): void {
  const a = axisOf(p);
  const x = a.boxX(offset, w);
  const { casting } = entry;

  p.rect(x, top, w, h, { stroke: p.colors.line, lineWidth: METRICS.border });

  const headH = 16;
  p.rect(x, top, w, headH, { fill: p.colors.tintGroup });
  p.textCentreBox(t.labelCasting, x + w / 2, top, headH, {
    size: TYPE.group,
    bold: true,
    color: p.colors.navy,
  });

  const labelW = w * 0.34;
  const rows: [string, [string, string][]][] = [
    [
      t.labelDescription,
      [
        ['', casting.description],
        [t.labelSizeQty, casting.sizeQty],
      ],
    ],
    [t.labelPump, [['', casting.pump]]],
    [
      t.labelConcrete,
      [
        [t.labelKind, casting.concreteType],
        [t.labelQty, casting.concreteQty],
      ],
    ],
  ];

  const rowH = (h - headH - 26) / rows.length;
  let y = top + headH;

  for (const [label, lines] of rows) {
    p.line(x, y, x + w, y, { color: p.colors.lineSoft, width: METRICS.hairline });
    const labelX = a.boxX(offset, labelW);
    p.rect(labelX, y, labelW, rowH, { fill: p.colors.panel });
    p.textCentreBox(label, labelX + labelW / 2, y, rowH, {
      size: TYPE.column,
      bold: true,
      color: p.colors.navy,
    });
    const divider = a.dir === 'rtl' ? labelX : labelX + labelW;
    p.line(divider, y, divider, y + rowH, {
      color: p.colors.lineSoft,
      width: METRICS.hairline,
    });

    const valueStart = a.dir === 'rtl' ? divider - 5 : divider + 5;
    let ly = y + (rowH - lines.length * 11) / 2 + 1;
    for (const [sub, value] of lines) {
      let cursor = valueStart;
      if (sub) {
        const subText = `${sub}:`;
        p.textStart(subText, cursor, ly + 1, {
          size: TYPE.tiny,
          bold: true,
          color: p.colors.muted,
        });
        const sw = p.width(subText, { size: TYPE.tiny, bold: true }) + 4;
        cursor = a.dir === 'rtl' ? cursor - sw : cursor + sw;
      }
      // What is left of the box from here to its far edge. The casting box is
      // 152pt wide and `משאבה 42 מ׳ — 4 שעות` is most of that already.
      const room = a.dir === 'rtl' ? cursor - (x + 5) : x + w - 5 - cursor;
      p.textStart(value, cursor, ly, { size: TYPE.cell, maxWidth: room });
      ly += 11;
    }
    y += rowH;
  }

  // Closing strip: the two free lines from the paper form.
  p.line(x, y, x + w, y, { color: p.colors.lineSoft, width: METRICS.hairline });
  const notes: [string, string][] = [
    [t.labelNotes, casting.notes],
    [t.labelConcreteType, casting.notesConcreteType],
  ];
  const noteStart = a.dir === 'rtl' ? x + w - 6 : x + 6;
  let ny = y + 4;
  for (const [label, value] of notes) {
    const labelText = `${label}:`;
    p.textStart(labelText, noteStart, ny, {
      size: TYPE.tiny,
      bold: true,
      color: p.colors.muted,
    });
    const lw = p.width(labelText, { size: TYPE.tiny, bold: true }) + 4;
    p.textStart(value, a.dir === 'rtl' ? noteStart - lw : noteStart + lw, ny - 0.5, {
      size: TYPE.tiny,
      maxWidth: w - 12 - lw,
    });
    ny += 10;
  }
}

function descriptionBlock(p: Painter, entry: DiaryEntry, t: Strings, top: number): number {
  const a = axisOf(p);
  const castingW = 152;
  const gap = 7;
  const textW = CONTENT_W - castingW - gap;
  const h = METRICS.descriptionLines * METRICS.descriptionLine + 10;

  const x = a.boxX(0, textW);
  p.rect(x, top, textW, h, { stroke: p.colors.line, lineWidth: METRICS.border });

  const pad = 9;
  const textStart = a.dir === 'rtl' ? x + textW - pad : x + pad;
  let y = top + 6;
  for (let i = 0; i < METRICS.descriptionLines; i += 1) {
    const lineY = y + METRICS.descriptionLine - 3.5;
    p.line(x + pad, lineY, x + textW - pad, lineY, {
      color: p.colors.lineSoft,
      width: METRICS.hairline,
    });
    y += METRICS.descriptionLine;
  }
  ruledText(p, entry.workDescription, {
    start: textStart,
    top: top + 7.5,
    width: textW - pad * 2,
    rules: METRICS.descriptionLines,
    pitch: METRICS.descriptionLine,
    size: TYPE.note,
  });

  castingBox(p, entry, t, textW + gap, castingW, top, h);
  return top + h;
}

/* --------------------------------------------- supervisor notes + signatures */

function footerBlock(
  p: Painter,
  entry: DiaryEntry,
  t: Strings,
  signatures: { supervisor?: PDFImage; manager?: PDFImage },
  top: number,
): number {
  const a = axisOf(p);
  const gap = 7;
  // Half and half, as the form draws it. The side column holds what was
  // delivered on top and the two signatures beneath it, side by side —
  // which is what the printed form gained when "התקבל היום" was added to it.
  const notesW = CONTENT_W * 0.5;
  const sideW = CONTENT_W - notesW - gap;
  // Unchanged: the same two rows the signatures used to occupy on their own.
  // The block must not grow — METRICS are tuned so a full day fits one sheet,
  // and a second sheet is the defect this renderer exists to make impossible.
  const h = METRICS.signatureBox * 2 + gap;

  const notesX = a.boxX(0, notesW);
  p.rect(notesX, top, notesW, h, { stroke: p.colors.line, lineWidth: METRICS.border });
  p.rect(notesX, top, notesW, 16, { fill: p.colors.tintHead });
  p.textStartBox(t.labelSupervisorNotes, a.dir === 'rtl' ? notesX + notesW : notesX, top, 16, {
    size: TYPE.group,
    bold: true,
    color: p.colors.navy,
    pad: 9,
  });

  const pad = 9;
  const textStart = a.dir === 'rtl' ? notesX + notesW - pad : notesX + pad;
  let y = top + 20;
  for (let i = 0; i < METRICS.supervisorLines; i += 1) {
    const lineY = y + 12.5;
    p.line(notesX + pad, lineY, notesX + notesW - pad, lineY, {
      color: p.colors.lineSoft,
      width: METRICS.hairline,
    });
    y += 14;
  }
  ruledText(p, entry.supervisorNotes, {
    start: textStart,
    top: top + 21,
    width: notesW - pad * 2,
    rules: METRICS.supervisorLines,
    pitch: 14,
    size: TYPE.note,
  });

  /* התקבל היום — the deliveries box, above the signatures. */
  const sideX = a.boxX(notesW + gap, sideW);
  p.rect(sideX, top, sideW, METRICS.signatureBox, {
    stroke: p.colors.line,
    lineWidth: METRICS.border,
  });
  p.rect(sideX, top, sideW, 16, { fill: p.colors.tintHead });
  p.textStartBox(t.labelReceivedToday, a.dir === 'rtl' ? sideX + sideW : sideX, top, 16, {
    size: TYPE.group,
    bold: true,
    color: p.colors.navy,
    pad: 9,
  });

  const receivedStart = a.dir === 'rtl' ? sideX + sideW - pad : sideX + pad;
  // Three ruled lines in the 46pt left under the heading bar, at 13pt each so
  // the last rule keeps clear of the frame instead of sitting on it.
  let ry = top + 18;
  for (let i = 0; i < METRICS.receivedLines; i += 1) {
    const lineY = ry + 11.5;
    p.line(sideX + pad, lineY, sideX + sideW - pad, lineY, {
      color: p.colors.lineSoft,
      width: METRICS.hairline,
    });
    ry += 13;
  }
  ruledText(p, entry.receivedToday ?? '', {
    start: receivedStart,
    top: top + 18.5,
    width: sideW - pad * 2,
    rules: METRICS.receivedLines,
    pitch: 13,
    size: TYPE.note,
  });

  /* The two signatures, sharing the row beneath it as the form now draws them. */
  const signTop = top + METRICS.signatureBox + gap;
  const signW = (sideW - gap) / 2;
  const boxes: [string, PDFImage | undefined][] = [
    [t.labelManagerSignature, signatures.manager],
    [t.labelSupervisorSignature, signatures.supervisor],
  ];
  boxes.forEach(([label, image], i) => {
    const x = a.boxX(notesW + gap + i * (signW + gap), signW);
    p.rect(x, signTop, signW, METRICS.signatureBox, {
      stroke: p.colors.line,
      lineWidth: METRICS.border,
    });
    p.textStart(label, a.dir === 'rtl' ? x + signW - 9 : x + 9, signTop + 6, {
      size: TYPE.label,
      bold: true,
      color: p.colors.navy,
    });
    if (image) {
      const maxW = signW - 20;
      const maxH = METRICS.signatureBox - 26;
      const scale = Math.min(maxW / image.width, maxH / image.height);
      const w = image.width * scale;
      const hh = image.height * scale;
      p.image(image, x + (signW - w) / 2, signTop + 20, w, hh);
    } else {
      const lineY = signTop + METRICS.signatureBox - 12;
      p.line(x + 12, lineY, x + signW - 12, lineY, {
        color: p.colors.lineSoft,
        width: METRICS.hairline,
      });
    }
  });

  return top + h;
}

/* --------------------------------------------------------------- the page */

export interface EntryImages {
  supervisor?: PDFImage;
  manager?: PDFImage;
  logo?: PDFImage;
}

/** Draws one complete diary page. */
export function drawEntryPage(
  p: Painter,
  entry: DiaryEntry,
  project: Project,
  images: EntryImages,
  chrome: PageChrome,
): void {
  const { t } = chrome;
  let y: number = PAGE.margin;
  y = drawHeaderBand(
    p,
    t.docWorkDiary,
    project.name,
    formatLongDate(entry.date, t),
    { ...chrome, logo: images.logo },
    y,
  );
  y += METRICS.gap;
  y = infoPanels(p, entry, project, t, y);
  y += METRICS.gap;
  y = sectionBar(p, t.labelCrewSection, y);
  y = crewTable(p, entry, t, y);
  y += METRICS.gap;
  y = sectionBar(p, t.labelWorkDescription, y);
  y = descriptionBlock(p, entry, t, y);
  y += METRICS.gap;
  footerBlock(p, entry, t, images, y);
  drawFooter(p, project, chrome);
}
