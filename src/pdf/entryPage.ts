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
import {
  CONTENT_W,
  COLORS,
  CREW_COLUMNS,
  METRICS,
  PAGE,
  TYPE,
  axisFor,
  type Axis,
} from './theme';

const LEFT = PAGE.margin;
const RIGHT = PAGE.margin + CONTENT_W;

export interface PageChrome {
  /** Company logo, if the user uploaded one. */
  logo?: PDFImage;
  pageNumber: number;
  pageCount: number;
  generatedAt: Date;
  t: Strings;
}

const axisOf = (p: Painter): Axis => axisFor(p.dir);

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
  p.rect(LEFT, top, CONTENT_W, h, { fill: COLORS.navy });
  // Amber rule along the bottom edge — the one splash of brand colour.
  p.rect(LEFT, top + h - 2.5, CONTENT_W, 2.5, { fill: COLORS.amber });

  const pad = 14;

  // The app mark sits on the starting edge, next to the title.
  const markSize = 22;
  const markX = a.boxX(pad, markSize);
  const markTop = top + (h - 2.5 - markSize) / 2;
  p.rect(markX, markTop, markSize, markSize, { fill: COLORS.amber });
  p.rect(markX + 4, markTop + 5, markSize - 8, markSize - 8, { fill: COLORS.white });
  for (let i = 0; i < 3; i += 1) {
    p.rect(markX + 6.5, markTop + 8 + i * 4, markSize - 13, 1.6, { fill: COLORS.navy });
  }

  const titleStart = a.dir === 'rtl' ? markX - 9 : markX + markSize + 9;
  p.textStart(title, titleStart, top + 12, {
    size: TYPE.title,
    bold: true,
    color: COLORS.white,
  });
  p.textStart(subtitle, titleStart, top + 34, {
    size: TYPE.subtitle,
    color: COLORS.tintGroup,
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
  drawEnd(detail, top + 14, { size: TYPE.subtitle, color: COLORS.white });
  drawEnd(chrome.t.docPage(chrome.pageNumber, chrome.pageCount), top + 34, {
    size: TYPE.label,
    color: COLORS.tintGroup,
  });

  return top + h;
}

/* ------------------------------------------------------------ footer band */

export function drawFooter(p: Painter, project: Project, chrome: PageChrome): void {
  const top = PAGE.height - PAGE.margin - METRICS.footerBand;
  p.line(LEFT, top, RIGHT, top, { color: COLORS.line, width: METRICS.hairline });

  const stamp = `${formatDdMmYyyy(chrome.generatedAt.toISOString().slice(0, 10))} ${chrome.generatedAt
    .toTimeString()
    .slice(0, 5)}`;
  const a = axisOf(p);
  const small = { size: TYPE.footer, color: COLORS.muted };

  p.textStart(project.company || project.name, a.startX, top + 5, small);
  p.textCenter(`${chrome.t.docGeneratedBy} · ${stamp}`, LEFT + CONTENT_W / 2, top + 5, small);
  if (a.dir === 'rtl') p.text(chrome.t.docPage(chrome.pageNumber, chrome.pageCount), LEFT, top + 5, small);
  else p.textRight(chrome.t.docPage(chrome.pageNumber, chrome.pageCount), RIGHT, top + 5, small);
}

/* -------------------------------------------------------------- section bar */

export function sectionBar(p: Painter, label: string, top: number): number {
  const a = axisOf(p);
  const h = METRICS.sectionBar;
  p.rect(LEFT, top, CONTENT_W, h, { fill: COLORS.tintHead });
  // Amber tick on the starting edge — reads as a bullet in either direction.
  p.rect(a.boxX(0, 3), top, 3, h, { fill: COLORS.amber });
  const textStart = a.dir === 'rtl' ? a.startX - 3 : a.startX + 3;
  p.textStartBox(label, textStart, top, h, {
    size: TYPE.section,
    bold: true,
    color: COLORS.navy,
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
      color: COLORS.navySoft,
    });
    const labelWidth = p.width(labelText, { size: TYPE.label, bold: true });
    const valueStart = a.dir === 'rtl' ? start - labelWidth - 6 : start + labelWidth + 6;
    p.textStart(value, valueStart, y - 0.5, { size: TYPE.value, color: COLORS.ink });
    const [x1, x2] = a.dir === 'rtl' ? [far, valueStart] : [valueStart, far];
    p.line(x1, y + 11, x2, y + 11, { color: COLORS.lineSoft, width: METRICS.hairline });
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
      fill: COLORS.panel,
      stroke: COLORS.line,
      lineWidth: METRICS.hairline,
    });
    p.textStart(heading, a.dir === 'rtl' ? x + w - 10 : x + 10, top + 7, {
      size: TYPE.group,
      bold: true,
      color: COLORS.navy,
    });
    p.line(x + 10, top + 20, x + w - 10, top + 20, {
      color: COLORS.line,
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

  p.rect(LEFT, y, CONTENT_W, METRICS.groupRow, { fill: COLORS.tintGroup });
  const groups: [string, number, number][] = [
    [t.labelManagement, 0, 2],
    [t.labelContractor, 2, 2],
    [t.labelEquipment, 4, 3],
  ];
  for (const [label, from, count] of groups) {
    p.textCentreBox(label, spanCentre(from, count), y, METRICS.groupRow, {
      size: TYPE.group,
      bold: true,
      color: COLORS.navy,
    });
  }
  y += METRICS.groupRow;

  p.rect(LEFT, y, CONTENT_W, METRICS.columnRow, { fill: COLORS.tintHead });
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
      color: COLORS.navy,
    });
  });
  y += METRICS.columnRow;

  const rowCount = Math.max(
    METRICS.minCrewRows,
    entry.management.length,
    entry.contractors.length,
    entry.equipment.length,
  );

  const bodyTop = y;
  for (let i = 0; i < rowCount; i += 1) {
    if (i % 2 === 1) p.rect(LEFT, y, CONTENT_W, METRICS.crewRow, { fill: COLORS.tintRow });
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
      p.textCentreBox(value, centreOf(col), y, METRICS.crewRow, { size: TYPE.cell });
    });
    y += METRICS.crewRow;
    p.line(LEFT, y, RIGHT, y, { color: COLORS.lineSoft, width: METRICS.hairline });
  }

  for (let i = 1; i < CREW_COLUMNS.length; i += 1) {
    const gx = a.boxX(offsets[i], CREW_COLUMNS[i]);
    const edge = a.dir === 'rtl' ? gx + CREW_COLUMNS[i] : gx;
    p.line(edge, top, edge, y, { color: COLORS.line, width: METRICS.hairline });
  }
  p.line(LEFT, bodyTop, RIGHT, bodyTop, { color: COLORS.line, width: METRICS.hairline });
  p.rect(LEFT, top, CONTENT_W, y - top, { stroke: COLORS.line, lineWidth: METRICS.border });

  return y;
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

  p.rect(x, top, w, h, { stroke: COLORS.line, lineWidth: METRICS.border });

  const headH = 16;
  p.rect(x, top, w, headH, { fill: COLORS.tintGroup });
  p.textCentreBox(t.labelCasting, x + w / 2, top, headH, {
    size: TYPE.group,
    bold: true,
    color: COLORS.navy,
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
    p.line(x, y, x + w, y, { color: COLORS.lineSoft, width: METRICS.hairline });
    const labelX = a.boxX(offset, labelW);
    p.rect(labelX, y, labelW, rowH, { fill: COLORS.panel });
    p.textCentreBox(label, labelX + labelW / 2, y, rowH, {
      size: TYPE.column,
      bold: true,
      color: COLORS.navy,
    });
    const divider = a.dir === 'rtl' ? labelX : labelX + labelW;
    p.line(divider, y, divider, y + rowH, {
      color: COLORS.lineSoft,
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
          color: COLORS.muted,
        });
        const sw = p.width(subText, { size: TYPE.tiny, bold: true }) + 4;
        cursor = a.dir === 'rtl' ? cursor - sw : cursor + sw;
      }
      p.textStart(value, cursor, ly, { size: TYPE.cell });
      ly += 11;
    }
    y += rowH;
  }

  // Closing strip: the two free lines from the paper form.
  p.line(x, y, x + w, y, { color: COLORS.lineSoft, width: METRICS.hairline });
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
      color: COLORS.muted,
    });
    const lw = p.width(labelText, { size: TYPE.tiny, bold: true }) + 4;
    p.textStart(value, a.dir === 'rtl' ? noteStart - lw : noteStart + lw, ny - 0.5, {
      size: TYPE.tiny,
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
  p.rect(x, top, textW, h, { stroke: COLORS.line, lineWidth: METRICS.border });

  const pad = 9;
  const lines = p.wrap(entry.workDescription, textW - pad * 2, { size: TYPE.note });
  const textStart = a.dir === 'rtl' ? x + textW - pad : x + pad;
  let y = top + 6;
  for (let i = 0; i < METRICS.descriptionLines; i += 1) {
    const lineY = y + METRICS.descriptionLine - 3.5;
    p.line(x + pad, lineY, x + textW - pad, lineY, {
      color: COLORS.lineSoft,
      width: METRICS.hairline,
    });
    if (lines[i]) p.textStart(lines[i], textStart, y + 1.5, { size: TYPE.note });
    y += METRICS.descriptionLine;
  }

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
  const notesW = CONTENT_W * 0.56;
  const signW = CONTENT_W - notesW - gap;
  const h = METRICS.signatureBox * 2 + gap;

  const notesX = a.boxX(0, notesW);
  p.rect(notesX, top, notesW, h, { stroke: COLORS.line, lineWidth: METRICS.border });
  p.rect(notesX, top, notesW, 16, { fill: COLORS.tintHead });
  p.textStartBox(t.labelSupervisorNotes, a.dir === 'rtl' ? notesX + notesW : notesX, top, 16, {
    size: TYPE.group,
    bold: true,
    color: COLORS.navy,
    pad: 9,
  });

  const pad = 9;
  const noteLines = p.wrap(entry.supervisorNotes, notesW - pad * 2, { size: TYPE.note });
  const textStart = a.dir === 'rtl' ? notesX + notesW - pad : notesX + pad;
  let y = top + 20;
  for (let i = 0; i < METRICS.supervisorLines; i += 1) {
    const lineY = y + 12.5;
    p.line(notesX + pad, lineY, notesX + notesW - pad, lineY, {
      color: COLORS.lineSoft,
      width: METRICS.hairline,
    });
    if (noteLines[i]) p.textStart(noteLines[i], textStart, y + 1, { size: TYPE.note });
    y += 14;
  }

  const signX = a.boxX(notesW + gap, signW);
  const boxes: [string, PDFImage | undefined][] = [
    [t.labelSupervisorSignature, signatures.supervisor],
    [t.labelManagerSignature, signatures.manager],
  ];
  let by = top;
  for (const [label, image] of boxes) {
    p.rect(signX, by, signW, METRICS.signatureBox, {
      stroke: COLORS.line,
      lineWidth: METRICS.border,
    });
    p.textStart(label, a.dir === 'rtl' ? signX + signW - 9 : signX + 9, by + 6, {
      size: TYPE.label,
      bold: true,
      color: COLORS.navy,
    });
    if (image) {
      const maxW = signW - 30;
      const maxH = METRICS.signatureBox - 26;
      const scale = Math.min(maxW / image.width, maxH / image.height);
      const w = image.width * scale;
      const hh = image.height * scale;
      p.image(image, signX + (signW - w) / 2, by + 20, w, hh);
    } else {
      const lineY = by + METRICS.signatureBox - 12;
      p.line(signX + 16, lineY, signX + signW - 16, lineY, {
        color: COLORS.lineSoft,
        width: METRICS.hairline,
      });
    }
    by += METRICS.signatureBox + gap;
  }

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
