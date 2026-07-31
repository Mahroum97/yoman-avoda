/**
 * Reusable pieces of the printed form: title bars, `label :- value` lines,
 * ruled writing areas and signature boxes.
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
  type IBorderOptions,
} from 'docx';
import {
  CONTENT_WIDTH,
  NONE,
  SIZE,
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
import { dataUrlToBase64 } from '../lib/images';

const CELL_MARGIN = { top: 40, bottom: 40, left: 90, right: 90 };

/** Full-width single cell bar, e.g. the `יומן עבודה` title. */
export function bar(
  text: string,
  opts: {
    size?: number;
    height?: number;
    border?: IBorderOptions;
    fill?: string;
    color?: string;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  } = {},
): Table {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    layout: TableLayoutType.FIXED,
    visuallyRightToLeft: isRtl(),
    borders: framedBorders(),
    rows: [
      new TableRow({
        height: { value: opts.height ?? 460, rule: HeightRule.ATLEAST },
        children: [
          new TableCell({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            margins: CELL_MARGIN,
            borders: boxBorders(opts.border ?? THIN),
            shading: opts.fill
              ? { type: ShadingType.CLEAR, fill: opts.fill, color: 'auto' }
              : undefined,
            children: [
              hePara(text, {
                size: opts.size ?? SIZE.section,
                bold: true,
                color: opts.color,
                align: opts.align ?? AlignmentType.CENTER,
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

/**
 * `label :- ______value______` — a borderless two-column row where the value
 * sits on an underline, mimicking the ruled blanks on the paper form.
 */
export function labelledLine(
  label: string,
  value: string,
  totalWidth: number,
  labelWidth = 1500,
): Table {
  const valueWidth = Math.max(400, totalWidth - labelWidth);
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: [labelWidth, valueWidth],
    layout: TableLayoutType.FIXED,
    visuallyRightToLeft: isRtl(),
    borders: noBorders(),
    rows: [
      new TableRow({
        height: { value: 420, rule: HeightRule.ATLEAST },
        children: [
          new TableCell({
            width: { size: labelWidth, type: WidthType.DXA },
            verticalAlign: VerticalAlign.BOTTOM,
            margins: { top: 20, bottom: 20, left: 40, right: 40 },
            borders: boxBorders(NONE),
            children: [hePara(`${label} :-`, { size: SIZE.label, bold: true })],
          }),
          new TableCell({
            width: { size: valueWidth, type: WidthType.DXA },
            verticalAlign: VerticalAlign.BOTTOM,
            margins: { top: 20, bottom: 20, left: 40, right: 40 },
            borders: { ...boxBorders(NONE), bottom: THIN },
            children: [hePara(value, { size: SIZE.value })],
          }),
        ],
      }),
    ],
  });
}

/**
 * A block of ruled lines carrying free text. Text is split across lines and the
 * block is padded to `minLines` so an empty page still prints its rules.
 */
export function ruledLines(
  text: string,
  minLines: number,
  opts: { size?: number; charsPerLine?: number } = {},
): Paragraph[] {
  const lines = wrapText(text, opts.charsPerLine ?? 92);
  const paras: Paragraph[] = [];
  const total = Math.max(minLines, lines.length);
  for (let i = 0; i < total; i += 1) {
    paras.push(
      heParaOf(lines[i] ? [he(lines[i], { size: opts.size ?? SIZE.note })] : [], {
        border: { bottom: THIN },
        spacingBefore: 60,
        spacingAfter: 60,
      }),
    );
  }
  return paras;
}

/**
 * Greedy wrap that respects the user's own newlines. Word would wrap long text
 * itself, but then it would overflow the ruled lines instead of filling them.
 */
export function wrapText(text: string, charsPerLine: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) {
      out.push('');
      continue;
    }
    let current = '';
    for (const word of rawLine.trim().split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > charsPerLine && current) {
        out.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) out.push(current);
  }
  return out;
}

/** A signature box: printed label plus the drawn signature, if there is one. */
export function signatureCell(
  label: string,
  dataUrl: string,
  width: number,
): TableCell {
  const children: Paragraph[] = [
    hePara(`${label} :-`, {
      size: SIZE.label,
      bold: true,
      underline: true,
      align: AlignmentType.CENTER,
    }),
  ];

  if (dataUrl) {
    children.push(
      heParaOf(
        [
          new ImageRun({
            type: 'png',
            data: dataUrlToBase64(dataUrl),
            transformation: { width: 190, height: 70 },
          }),
        ],
        { align: AlignmentType.CENTER, spacingBefore: 60 },
      ),
    );
  } else {
    children.push(blankPara(), blankPara());
  }

  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: CELL_MARGIN,
    borders: boxBorders(THIN),
    children,
  });
}

export { CELL_MARGIN };
