/**
 * One diary page, laid out to match the printed form
 * "יומן עבודה לעבודות בנייה.pdf" section for section.
 *
 * Every table sets `visuallyRightToLeft`, so the first cell of a row renders at
 * the RIGHT edge — column arrays in this file are therefore written in the
 * order a Hebrew reader sees them.
 */
import {
  AlignmentType,
  HeightRule,
  ImageRun,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  ShadingType,
  TableRow,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { DiaryEntry, Project } from '../types';
import type { Strings } from '../i18n/strings';
import { formatDdMmYyyy, formatLongDate } from '../lib/dates';
import {
  CELL_MARGIN,
  bar,
  labelledLine,
  ruledLines,
  signatureCell,
} from './blocks';
import {
  CONTENT_WIDTH,
  FILL,
  INK,
  NONE,
  SIZE,
  THICK,
  THIN,
  blankPara,
  boxBorders,
  framedBorders,
  he,
  hePara,
  heParaOf,
  isRtl,
  noBorders,
} from './theme';

/** Minimum body rows in the crew/equipment grid, as on the paper form. */
const MIN_CREW_ROWS = 6;
/** Ruled lines reserved for the work description and the supervisor notes. */
const DESCRIPTION_LINES = 13;
const SUPERVISOR_LINES = 9;

/**
 * Column widths of the crew + equipment grid, right to left:
 * שם | תפקיד | מקצוע | כמות עובדים | סוג | כמות | שט"ע
 * They must sum to CONTENT_WIDTH or Word will rescale the table.
 */
const CREW_COLUMNS = [1750, 1500, 1700, 1000, 1900, 1550, 1486];

if (CREW_COLUMNS.reduce((a, b) => a + b, 0) !== CONTENT_WIDTH) {
  throw new Error('רוחב עמודות הטבלה אינו תואם לרוחב העמוד');
}

const HALF = Math.floor(CONTENT_WIDTH / 2);

/* ------------------------------------------------- פרויקט / תאריך-מזג האוויר */

function headerBlock(entry: DiaryEntry, project: Project, t: Strings): Table {
  const cell = (heading: string, lines: [string, string][]) =>
    new TableCell({
      width: { size: HALF, type: WidthType.DXA },
      verticalAlign: VerticalAlign.TOP,
      margins: CELL_MARGIN,
      borders: boxBorders(THIN),
      children: [
        hePara(`${heading} :-`, {
          size: SIZE.groupHeader,
          bold: true,
          underline: true,
          align: AlignmentType.CENTER,
          spacingAfter: 60,
        }),
        ...lines.map(([label, value]) =>
          labelledLine(label, value, HALF - 260, 1250),
        ),
      ],
    });

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [HALF, CONTENT_WIDTH - HALF],
    layout: TableLayoutType.FIXED,
    visuallyRightToLeft: isRtl(),
    borders: framedBorders(),
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          cell(t.labelProject, [
            [t.labelProjectName, project.name],
            [t.labelAddress, project.address],
            [t.labelCompany, project.company],
          ]),
          cell(t.labelDateWeather, [
            [t.labelDate, formatLongDate(entry.date, t)],
            [t.labelWeather, entry.weather],
          ]),
        ],
      }),
    ],
  });
}

/* ------------------------------------- רישום יומי של עובדים וציוד */

function gridCell(
  text: string,
  width: number,
  opts: {
    bold?: boolean;
    size?: number;
    span?: number;
    fill?: string;
    color?: string;
  } = {},
): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: opts.span,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 30, bottom: 30, left: 60, right: 60 },
    borders: boxBorders(THIN),
    shading: opts.fill
      ? { type: ShadingType.CLEAR, fill: opts.fill, color: 'auto' }
      : undefined,
    children: [
      hePara(text, {
        bold: opts.bold,
        size: opts.size ?? SIZE.cell,
        color: opts.color,
        align: AlignmentType.CENTER,
      }),
    ],
  });
}

function crewTable(entry: DiaryEntry, t: Strings): Table {
  const [wName, wRole, wTrade, wWorkers, wKind, wQty, wHours] = CREW_COLUMNS;

  const groupRow = new TableRow({
    tableHeader: true,
    height: { value: 460, rule: HeightRule.ATLEAST },
    children: [
      gridCell(t.labelManagement, wName + wRole, {
        bold: true,
        size: SIZE.groupHeader,
        span: 2,
        fill: FILL.tintGroup,
        color: INK.navy,
      }),
      gridCell(t.labelContractor, wTrade + wWorkers, {
        bold: true,
        size: SIZE.groupHeader,
        span: 2,
        fill: FILL.tintGroup,
        color: INK.navy,
      }),
      gridCell(t.labelEquipment, wKind + wQty + wHours, {
        bold: true,
        size: SIZE.groupHeader,
        span: 3,
        fill: FILL.tintGroup,
        color: INK.navy,
      }),
    ],
  });

  const columnRow = new TableRow({
    tableHeader: true,
    height: { value: 400, rule: HeightRule.ATLEAST },
    children: [
      gridCell(t.labelName, wName, { bold: true, size: SIZE.columnHeader, fill: FILL.tintHead, color: INK.navy }),
      gridCell(t.labelRole, wRole, { bold: true, size: SIZE.columnHeader, fill: FILL.tintHead, color: INK.navy }),
      gridCell(t.labelTrade, wTrade, { bold: true, size: SIZE.columnHeader, fill: FILL.tintHead, color: INK.navy }),
      // Narrow column; the paper form prints this label in two small lines.
      gridCell(t.labelWorkers, wWorkers, { bold: true, size: SIZE.tiny, fill: FILL.tintHead, color: INK.navy }),
      gridCell(t.labelKind, wKind, { bold: true, size: SIZE.columnHeader, fill: FILL.tintHead, color: INK.navy }),
      gridCell(t.labelQty, wQty, { bold: true, size: SIZE.columnHeader, fill: FILL.tintHead, color: INK.navy }),
      gridCell(t.labelHours, wHours, { bold: true, size: SIZE.columnHeader, fill: FILL.tintHead, color: INK.navy }),
    ],
  });

  const rowCount = Math.max(
    MIN_CREW_ROWS,
    entry.management.length,
    entry.contractors.length,
    entry.equipment.length,
  );

  const bodyRows = Array.from({ length: rowCount }, (_, i) => {
    const staff = entry.management[i];
    const contractor = entry.contractors[i];
    const equipment = entry.equipment[i];
    // Alternating tint, the same zebra the PDF uses.
    const stripe = i % 2 === 1 ? FILL.row : undefined;
    return new TableRow({
      height: { value: 540, rule: HeightRule.ATLEAST },
      children: [
        gridCell(staff?.name ?? '', wName, { fill: stripe }),
        gridCell(staff?.role ?? '', wRole, { fill: stripe }),
        gridCell(contractor?.trade ?? '', wTrade, { fill: stripe }),
        gridCell(contractor?.workers ?? '', wWorkers, { fill: stripe }),
        gridCell(equipment?.kind ?? '', wKind, { fill: stripe }),
        gridCell(equipment?.qty ?? '', wQty, { fill: stripe }),
        gridCell(equipment?.hours ?? '', wHours, { fill: stripe }),
      ],
    });
  });

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: CREW_COLUMNS,
    layout: TableLayoutType.FIXED,
    visuallyRightToLeft: isRtl(),
    borders: framedBorders(),
    rows: [groupRow, columnRow, ...bodyRows],
  });
}

/* --------------------------- תיאור העבודה שבוצעה + פרטי יציקה */

/** One row of the casting box: printed label on the right, value on the left. */
function castingRow(
  label: string,
  labelWidth: number,
  valueWidth: number,
  valueLines: { label?: string; value: string }[],
  height = 420,
): TableRow {
  return new TableRow({
    height: { value: height, rule: HeightRule.ATLEAST },
    children: [
      new TableCell({
        width: { size: labelWidth, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        margins: CELL_MARGIN,
        borders: boxBorders(THIN),
        children: [
          hePara(label, {
            bold: true,
            size: SIZE.columnHeader,
            align: AlignmentType.CENTER,
          }),
        ],
      }),
      new TableCell({
        width: { size: valueWidth, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 30, bottom: 30, left: 60, right: 60 },
        borders: boxBorders(THIN),
        children: valueLines.map((line) =>
          heParaOf(
            [
              ...(line.label ? [he(`${line.label} :- `, { size: SIZE.tiny, bold: true })] : []),
              he(line.value, { size: SIZE.cell }),
            ],
            { align: AlignmentType.RIGHT },
          ),
        ),
      }),
    ],
  });
}

function castingBox(entry: DiaryEntry, t: Strings, width: number): Table {
  const labelWidth = Math.round(width * 0.52);
  const valueWidth = width - labelWidth;
  const { casting } = entry;

  return new Table({
    width: { size: width, type: WidthType.DXA },
    columnWidths: [labelWidth, valueWidth],
    layout: TableLayoutType.FIXED,
    visuallyRightToLeft: isRtl(),
    borders: framedBorders(),
    rows: [
      new TableRow({
        height: { value: 400, rule: HeightRule.ATLEAST },
        children: [
          new TableCell({
            width: { size: width, type: WidthType.DXA },
            columnSpan: 2,
            verticalAlign: VerticalAlign.CENTER,
            margins: CELL_MARGIN,
            borders: boxBorders(THIN),
            children: [
              hePara(t.labelCasting, {
                bold: true,
                size: SIZE.groupHeader,
                align: AlignmentType.CENTER,
              }),
            ],
          }),
        ],
      }),
      castingRow(t.labelDescription, labelWidth, valueWidth, [
        { value: casting.description },
        { label: t.labelSizeQty, value: casting.sizeQty },
      ]),
      castingRow(t.labelPump, labelWidth, valueWidth, [{ value: casting.pump }]),
      castingRow(
        t.labelConcrete,
        labelWidth,
        valueWidth,
        [
          { label: t.labelConcreteType, value: casting.concreteType },
          { label: t.labelConcreteQty, value: casting.concreteQty },
        ],
        620,
      ),
      // Closing strip of the box: two free lines spanning its full width.
      new TableRow({
        height: { value: 420, rule: HeightRule.ATLEAST },
        children: [
          new TableCell({
            width: { size: width, type: WidthType.DXA },
            columnSpan: 2,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 30, bottom: 30, left: 60, right: 60 },
            borders: boxBorders(THIN),
            children: [
              heParaOf(
                [
                  he(`${t.labelNotes} :- `, { size: SIZE.tiny, bold: true }),
                  he(casting.notes, { size: SIZE.cell }),
                ],
                {},
              ),
              heParaOf(
                [
                  he(`${t.labelConcreteType} :- `, { size: SIZE.tiny, bold: true }),
                  he(casting.notesConcreteType, { size: SIZE.cell }),
                ],
                {},
              ),
            ],
          }),
        ],
      }),
    ],
  });
}

function descriptionBlock(entry: DiaryEntry, t: Strings): Table {
  const castingWidth = 3000;
  const textWidth = CONTENT_WIDTH - castingWidth;

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [textWidth, castingWidth],
    layout: TableLayoutType.FIXED,
    visuallyRightToLeft: isRtl(),
    borders: framedBorders(),
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: textWidth, type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
            borders: boxBorders(THIN),
            children: ruledLines(entry.workDescription, DESCRIPTION_LINES),
          }),
          new TableCell({
            width: { size: castingWidth, type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            borders: boxBorders(NONE),
            children: [castingBox(entry, t, castingWidth)],
          }),
        ],
      }),
    ],
  });
}

/* --------------------------------- הערות המפקח + חתימות */

function footerBlock(entry: DiaryEntry, t: Strings): Table {
  const notesWidth = HALF;
  const signWidth = CONTENT_WIDTH - notesWidth;

  const signatures = new Table({
    width: { size: signWidth, type: WidthType.DXA },
    columnWidths: [signWidth],
    layout: TableLayoutType.FIXED,
    visuallyRightToLeft: isRtl(),
    borders: framedBorders(),
    rows: [
      new TableRow({
        height: { value: 1850, rule: HeightRule.ATLEAST },
        children: [signatureCell(t.labelSupervisorSignature, entry.supervisorSignature, signWidth)],
      }),
      new TableRow({
        height: { value: 1850, rule: HeightRule.ATLEAST },
        children: [signatureCell(t.labelManagerSignature, entry.managerSignature, signWidth)],
      }),
    ],
  });

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [notesWidth, signWidth],
    layout: TableLayoutType.FIXED,
    visuallyRightToLeft: isRtl(),
    borders: framedBorders(),
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: notesWidth, type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
            borders: boxBorders(THIN),
            children: [
              hePara(`${t.labelSupervisorNotes} :-`, {
                bold: true,
                size: SIZE.label,
                underline: true,
                align: AlignmentType.CENTER,
                spacingAfter: 80,
              }),
              ...ruledLines(entry.supervisorNotes, SUPERVISOR_LINES, {
                charsPerLine: 44,
              }),
            ],
          }),
          new TableCell({
            width: { size: signWidth, type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            borders: boxBorders(NONE),
            children: [signatures],
          }),
        ],
      }),
    ],
  });
}

/* ------------------------------------------------------- נספח תמונות */

/** Photos, two per row, scaled to fit their slot without distortion. */
export function photoAppendix(
  entry: DiaryEntry,
  t: Strings,
  images: Map<string, Uint8Array>,
): (Table | Paragraph)[] {
  if (entry.photos.length === 0) return [];

  const columnWidth = Math.floor(CONTENT_WIDTH / 2);
  const slot = { width: 300, height: 225 }; // px, as ImageRun measures
  const rows: TableRow[] = [];

  for (let i = 0; i < entry.photos.length; i += 2) {
    const pair = entry.photos.slice(i, i + 2);
    rows.push(
      new TableRow({
        cantSplit: true,
        children: Array.from({ length: 2 }, (_, col) => {
          const photo = pair[col];
          const data = photo ? images.get(photo.id) : undefined;
          if (!photo || !data) {
            return new TableCell({
              width: { size: columnWidth, type: WidthType.DXA },
              borders: boxBorders(NONE),
              children: [blankPara()],
            });
          }
          const scale = Math.min(
            slot.width / photo.width,
            slot.height / photo.height,
          );
          return new TableCell({
            width: { size: columnWidth, type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            borders: boxBorders(NONE),
            children: [
              heParaOf(
                [
                  new ImageRun({
                    type: 'jpg',
                    data,
                    transformation: {
                      width: Math.round(photo.width * scale),
                      height: Math.round(photo.height * scale),
                    },
                  }),
                ],
                { align: AlignmentType.CENTER },
              ),
              hePara(photo.caption || t.photoNumber(i + col + 1), {
                size: SIZE.tiny,
                align: AlignmentType.CENTER,
                spacingBefore: 60,
              }),
            ],
          });
        }),
      }),
    );
  }

  return [
    bar(`${t.docPhotoAppendix} — ${formatDdMmYyyy(entry.date)}`, {
      size: SIZE.groupHeader,
      fill: FILL.navy,
      color: INK.white,
    }),
    blankPara(),
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [columnWidth, CONTENT_WIDTH - columnWidth],
      layout: TableLayoutType.FIXED,
      visuallyRightToLeft: isRtl(),
      borders: noBorders(),
      rows,
    }),
  ];
}

/* ------------------------------------------------------------- the page */

/** The full diary page, top to bottom, exactly as the form is printed. */
export function entryPage(entry: DiaryEntry, project: Project, t: Strings): (Table | Paragraph)[] {
  return [
    bar(t.docWorkDiary, {
      size: SIZE.title,
      height: 560,
      border: THICK,
      fill: FILL.navy,
      color: INK.white,
    }),
    headerBlock(entry, project, t),
    bar(t.labelCrewSection, { fill: FILL.tintHead, color: INK.navy }),
    crewTable(entry, t),
    bar(t.labelWorkDescription, { fill: FILL.tintHead, color: INK.navy }),
    descriptionBlock(entry, t),
    footerBlock(entry, t),
  ];
}
