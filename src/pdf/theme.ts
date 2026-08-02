/**
 * Geometry and palette for the generated PDF.
 *
 * Everything is in PostScript points (72 per inch), the unit pdf-lib works in.
 * The column proportions are the same as the Word builder's CREW_COLUMNS, so
 * the two documents lay out identically.
 */
import { rgb, type RGB } from 'pdf-lib';
import type { Direction } from '../i18n/strings';
import { DEFAULT_DOC_THEME, docTheme, rgbOf, type DocTheme } from '../docTheme';

export const PAGE = {
  width: 595.28, // A4
  height: 841.89,
  margin: 28,
} as const;

export const CONTENT_W = PAGE.width - PAGE.margin * 2;

/** Same ratios as CREW_COLUMNS in src/docx/entryPage.ts, right to left. */
const CREW_RATIOS = [1750, 1500, 1700, 1000, 1900, 1550, 1486];
const CREW_TOTAL = CREW_RATIOS.reduce((a, b) => a + b, 0);

export const CREW_COLUMNS = CREW_RATIOS.map((r) => (r / CREW_TOTAL) * CONTENT_W);

/** Greys and rules are shared by every palette; only the brand tints change. */
const NEUTRAL = {
  ink: rgb(0.063, 0.078, 0.094),
  muted: rgb(0.357, 0.4, 0.459),
  line: rgb(0.788, 0.824, 0.871), // #C9D2DE
  lineSoft: rgb(0.882, 0.906, 0.937),
  white: rgb(1, 1, 1),
} as const;

export type Palette = typeof NEUTRAL & {
  navy: RGB;
  navySoft: RGB;
  amber: RGB;
  tintGroup: RGB;
  tintHead: RGB;
  tintRow: RGB;
  panel: RGB;
};

const toRgb = (hex: string): RGB => {
  const { r, g, b } = rgbOf(hex);
  return rgb(r, g, b);
};

/** Builds the drawing palette for a chosen document theme. */
export function paletteFor(theme: DocTheme): Palette {
  const band = rgbOf(theme.band);
  return {
    ...NEUTRAL,
    navy: toRgb(theme.band),
    // A lightened band colour, for the small labels inside the info panels.
    navySoft: rgb(
      Math.min(1, band.r + 0.08),
      Math.min(1, band.g + 0.1),
      Math.min(1, band.b + 0.14),
    ),
    amber: toRgb(theme.accent),
    tintGroup: toRgb(theme.tintGroup),
    tintHead: toRgb(theme.tintHead),
    tintRow: toRgb(theme.row),
    panel: toRgb(theme.panel),
  };
}

/** The default palette, used where no theme has been threaded through yet. */
export const COLORS: Palette = paletteFor(docTheme(DEFAULT_DOC_THEME));

/** Type scale, in points. */
export const TYPE = {
  title: 17,
  subtitle: 9.5,
  section: 10.5,
  group: 9.5,
  column: 8,
  cell: 8.5,
  label: 7.5,
  value: 8.5,
  tiny: 6.5,
  note: 8.5,
  footer: 7,
} as const;

/** Vertical rhythm of the page, in points. */
export const METRICS = {
  headerBand: 62,
  gap: 7,
  infoPanel: 74,
  sectionBar: 19,
  groupRow: 17,
  columnRow: 15,
  crewRow: 21.5,
  minCrewRows: 6,
  descriptionLines: 13,
  descriptionLine: 15.5,
  supervisorLines: 9,
  receivedLines: 3,
  signatureBox: 62,
  footerBand: 16,
  hairline: 0.6,
  border: 0.9,
} as const;

/**
 * Maps "logical" positions (measured from the edge the language starts at)
 * onto physical x coordinates, so one layout serves both directions.
 */
export interface Axis {
  dir: Direction;
  /** Physical left edge of a box that begins `offset` from the start edge. */
  boxX: (offset: number, width: number) => number;
  /** The edge text is aligned to first: right in Hebrew/Arabic, left in English. */
  startX: number;
  endX: number;
}

export function axisFor(dir: Direction): Axis {
  const left = PAGE.margin;
  const right = PAGE.margin + CONTENT_W;
  return {
    dir,
    boxX: (offset, width) => (dir === 'rtl' ? right - offset - width : left + offset),
    startX: dir === 'rtl' ? right : left,
    endX: dir === 'rtl' ? left : right,
  };
}
