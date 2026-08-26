/**
 * How tall a row of the crew table is, given how many rows the day has.
 *
 * The printed form has six ruled rows and the page budget was built for them:
 * everything under the table — the description, the casting box, the notes,
 * what was delivered and the two signatures — has a fixed height, and the sheet
 * has room for eight rows before the last of it is pushed off the bottom edge.
 * A real site has more trades than that on a busy day, and the page said
 * nothing: it drew the rows, drew the blocks below them past the end of the
 * paper, and printed a day with no signatures on it.
 *
 * So the table takes the room it is allowed and divides it. Up to eight rows
 * nothing changes; past that the rows tighten, down to a floor that is still
 * readable — about fifteen trades in one day, which is more than a site runs.
 *
 * `src/pdf/entryPage.ts` checks `CREW_BODY` against the real `METRICS` at
 * import and throws if a height beneath the table has changed without this
 * being changed with it, so the number cannot quietly go stale.
 */

/** Points of page left for the rows themselves. */
export const CREW_BODY = 185;

/** The form's own row height, in points. */
export const CREW_ROW_FULL = 21.5;

/** Tighter than this stops being a table and starts being a paragraph. */
export const CREW_ROW_MIN = 12;

export function crewRowHeight(rows: number): number {
  if (rows <= 0) return CREW_ROW_FULL;
  return Math.max(CREW_ROW_MIN, Math.min(CREW_ROW_FULL, CREW_BODY / rows));
}

/** Cell type shrinks with the row, so a tight table still has air in it. */
export function crewTextSize(rowHeight: number, full: number): number {
  return Math.min(full, Math.max(6.5, rowHeight - 5));
}
