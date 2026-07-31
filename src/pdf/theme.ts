/**
 * Geometry and palette for the generated PDF.
 *
 * Everything is in PostScript points (72 per inch), the unit pdf-lib works in.
 * The column proportions are the same as the Word builder's CREW_COLUMNS, so
 * the two documents lay out identically.
 */
import { rgb } from 'pdf-lib';
import type { Direction } from '../i18n/strings';

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

export const COLORS = {
  navy: rgb(0.059, 0.176, 0.29), // #0F2D4A
  navySoft: rgb(0.11, 0.28, 0.44),
  amber: rgb(0.851, 0.467, 0.024), // #D97706
  ink: rgb(0.063, 0.078, 0.094),
  muted: rgb(0.357, 0.4, 0.459),
  line: rgb(0.788, 0.824, 0.871), // #C9D2DE
  lineSoft: rgb(0.882, 0.906, 0.937),
  tintGroup: rgb(0.863, 0.894, 0.933), // table group header
  tintHead: rgb(0.937, 0.953, 0.973), // column header + section bars
  tintRow: rgb(0.98, 0.984, 0.992), // zebra stripe
  panel: rgb(0.969, 0.976, 0.984), // info panels
  white: rgb(1, 1, 1),
} as const;

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
