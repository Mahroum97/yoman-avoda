/**
 * Shared measurements and run/paragraph factories for the Word export.
 *
 * All widths are in twips (1/20 pt) because that is what Word's table model
 * uses; keeping the column arithmetic in one place is what makes the generated
 * page line up with the original A4 form.
 */
import type { Direction } from '../i18n/strings';
import type { DocTheme } from '../docTheme';
import {
  AlignmentType,
  BorderStyle,
  Paragraph,
  TextRun,
  type IBorderOptions,
  type ParagraphChild,
} from 'docx';

/** A4 in twips, and the printable width once margins are subtracted. */
export const PAGE = {
  widthTwips: 11906,
  heightTwips: 16838,
  margin: 510, // ~0.9 cm — matches the thin border of the printed form
} as const;

export const CONTENT_WIDTH = PAGE.widthTwips - PAGE.margin * 2; // 10886

/**
 * The typeface named in the .docx.
 *
 * Module state set at the top of a build, exactly like the direction below and
 * safe for the same reason: a build is synchronous. Arial is the fallback
 * because it covers Hebrew on every Windows and macOS Word install — a name
 * the reader's Word does not have is silently substituted, which is the one
 * way a Word file differs from the PDF, where the face is embedded.
 */
let docFont = 'Arial';

export const setDocFont = (family: string): void => {
  docFont = family;
};

export const FONT = (): string => docFont;

/** Font sizes in half-points. */
export const SIZE = {
  title: 34,
  section: 24,
  groupHeader: 22,
  columnHeader: 18,
  cell: 18,
  label: 18,
  value: 19,
  tiny: 13,
  note: 18,
} as const;

/**
 * Brand palette, matching src/pdf/theme.ts. Word wants hex without the hash.
 *
 * Mutable, and set by `setDocPalette` at the top of a build alongside the
 * direction — the properties are updated in place so every importer sees the
 * change regardless of how it imported them.
 */
export const FILL = {
  navy: '0F2D4A',
  amber: 'D97706',
  tintGroup: 'DCE4EE',
  tintHead: 'EFF3F8',
  panel: 'F7F9FB',
  row: 'FAFBFD',
};

export const INK = {
  white: 'FFFFFF',
  navy: '0F2D4A',
  navySoft: '1C4870',
  muted: '5B6675',
};

export function setDocPalette(theme: DocTheme): void {
  FILL.navy = theme.band;
  FILL.amber = theme.accent;
  FILL.tintGroup = theme.tintGroup;
  FILL.tintHead = theme.tintHead;
  FILL.panel = theme.panel;
  FILL.row = theme.row;
  INK.navy = theme.band;
  INK.navySoft = theme.band;
}

/** Border weights are eighths of a point: 6 = 0.75pt, 12 = 1.5pt. */
export const THIN: IBorderOptions = {
  style: BorderStyle.SINGLE,
  size: 6,
  color: '000000',
};

export const THICK: IBorderOptions = {
  style: BorderStyle.SINGLE,
  size: 14,
  color: '000000',
};

export const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

export const boxBorders = (border: IBorderOptions = THIN) => ({
  top: border,
  bottom: border,
  left: border,
  right: border,
});

export const framedBorders = () => ({
  top: THICK,
  bottom: THICK,
  left: THICK,
  right: THICK,
  insideHorizontal: THIN,
  insideVertical: THIN,
});

export const noBorders = () => ({
  top: NONE,
  bottom: NONE,
  left: NONE,
  right: NONE,
  insideHorizontal: NONE,
  insideVertical: NONE,
});

/**
 * The direction of the document currently being built.
 *
 * Module state rather than a parameter threaded through every helper: a build is
 * synchronous and single-threaded, and `buildEntryDoc`/`buildRangeDoc` set this
 * before they construct anything.
 */
let docDirection: Direction = 'rtl';

export function setDocDirection(dir: Direction): void {
  docDirection = dir;
}

export const isRtl = (): boolean => docDirection === 'rtl';

/** Start-edge alignment for the current direction. */
export const startAlign = () =>
  docDirection === 'rtl' ? AlignmentType.RIGHT : AlignmentType.LEFT;

export interface RunOpts {
  bold?: boolean;
  size?: number;
  underline?: boolean;
  color?: string;
  italics?: boolean;
}

/**
 * Every run must carry `rightToLeft` so Word applies the complex-script font
 * and orders the Hebrew glyphs correctly.
 */
export function he(text: string, opts: RunOpts = {}): TextRun {
  return new TextRun({
    text,
    rightToLeft: docDirection === 'rtl',
    font: FONT(),
    size: opts.size ?? SIZE.cell,
    bold: opts.bold,
    italics: opts.italics,
    color: opts.color,
    underline: opts.underline ? { type: 'single' } : undefined,
  });
}

export interface ParaOpts extends RunOpts {
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  spacingBefore?: number;
  spacingAfter?: number;
  border?: { bottom?: IBorderOptions };
}

/** A bidirectional (RTL) paragraph holding one Hebrew run. */
export function hePara(text: string, opts: ParaOpts = {}): Paragraph {
  return heParaOf([he(text, opts)], opts);
}

/** A bidirectional paragraph holding arbitrary children (runs, images). */
export function heParaOf(children: ParagraphChild[], opts: ParaOpts = {}): Paragraph {
  return new Paragraph({
    children,
    bidirectional: docDirection === 'rtl',
    alignment: opts.align ?? startAlign(),
    spacing: {
      before: opts.spacingBefore ?? 0,
      after: opts.spacingAfter ?? 0,
    },
    border: opts.border,
  });
}

/** Empty spacer paragraph inside a cell. */
export const blankPara = (): Paragraph =>
  new Paragraph({
    children: [],
    bidirectional: docDirection === 'rtl',
    spacing: { before: 0, after: 0 },
  });
