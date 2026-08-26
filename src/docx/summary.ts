/**
 * Aggregations behind the range report. Quantities on the form are free text
 * ("3", "3 עובדים", "12 מ\"ק"), so every number is parsed leniently and text
 * that carries no number simply contributes a day rather than a quantity.
 */
import type { DiaryEntry } from '../types';

/**
 * First number in a free-text field, or 0. Accepts `12`, `12.5`, `12 מ"ק`.
 *
 * Tolerates a missing field rather than assuming one. Every page the editor
 * creates is complete, but a page can also arrive from a sync or a restored
 * backup written by an older version, and one absent quantity used to take the
 * whole range report down with "cannot read properties of undefined".
 */
export function parseNum(raw: string | undefined | null): number {
  if (typeof raw !== 'string') return 0;
  const match = raw.replace(',', '.').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

export interface Tally {
  label: string;
  /** Summed quantity across the period. */
  total: number;
  /** How many diary pages mentioned this label. */
  days: number;
}

/**
 * `day` is which diary page the row came from, and it is what the column headed
 * ימים counts. Counting rows instead — which is what this did — turned a trade
 * written on two lines of one page, two crews of electricians on one morning,
 * into two days of electricians.
 */
function tally(rows: { label: string; value: number; day: number }[]): Tally[] {
  const map = new Map<string, { label: string; total: number; days: Set<number> }>();
  for (const { label, value, day } of rows) {
    const key = label.trim();
    if (!key) continue;
    const existing = map.get(key) ?? { label: key, total: 0, days: new Set<number>() };
    existing.total += value;
    existing.days.add(day);
    map.set(key, existing);
  }
  return [...map.values()]
    .map(({ label, total, days }) => ({ label, total, days: days.size }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'he'));
}

export interface RangeSummary {
  days: number;
  /** Days where any crew or contractor was recorded. */
  activeDays: number;
  trades: Tally[];
  equipment: Tally[];
  concrete: Tally[];
  concreteTotal: number;
  castingDays: number;
  photos: number;
  signedDays: number;
}

export function summarise(entries: DiaryEntry[]): RangeSummary {
  type Row = { label: string; value: number; day: number };
  const tradeRows: Row[] = [];
  const equipmentRows: Row[] = [];
  const concreteRows: Row[] = [];
  let castingDays = 0;
  let photos = 0;
  let signedDays = 0;
  let activeDays = 0;

  /*
   * Read defensively throughout, for the same reason `parseNum` does: a page
   * may predate a field, or arrive from a device running an older version. A
   * summary that omits one incomplete day is a far better outcome than a report
   * that refuses to be produced at all.
   */
  const text = (value: string | undefined | null): string =>
    typeof value === 'string' ? value.trim() : '';

  for (const [day, entry] of entries.entries()) {
    for (const row of entry.contractors ?? []) {
      tradeRows.push({ label: text(row.trade), value: parseNum(row.workers), day });
    }
    for (const row of entry.equipment ?? []) {
      equipmentRows.push({ label: text(row.kind), value: parseNum(row.hours), day });
    }

    const casting = entry.casting ?? {};
    const qty = parseNum(casting.concreteQty);
    const type = text(casting.concreteType);
    if (qty > 0 || type) {
      concreteRows.push({ label: type || 'ללא ציון סוג', value: qty, day });
    }
    if (qty > 0 || type || text(casting.description)) castingDays += 1;
    if ((entry.management?.length ?? 0) > 0 || (entry.contractors?.length ?? 0) > 0) {
      activeDays += 1;
    }

    photos += entry.photos?.length ?? 0;
    // The same rule as `statusFor` in src/db.ts: a page carrying a מנ"ע
    // signature is signed whatever its stored status says. Reading the stored
    // value alone under-counted pages that arrived from a device old enough to
    // predate that rule — the cover's "יומנים חתומים" is the one figure in the
    // report a reader checks against the pages behind it.
    if (entry.status === 'signed' || text(entry.managerSignature)) signedDays += 1;
  }

  const concrete = tally(concreteRows);
  return {
    days: entries.length,
    activeDays,
    trades: tally(tradeRows),
    equipment: tally(equipmentRows),
    concrete,
    concreteTotal: concrete.reduce((sum, row) => sum + row.total, 0),
    castingDays,
    photos,
    signedDays,
  };
}

/**
 * Trims trailing zeros: 12.50 -> `12.5`, 12.00 -> `12`.
 *
 * Through `Number`, because stripping the zeros as text left the dot behind:
 * 12.001 rounded to "12.00" and came out of the report as `12.`
 */
export function formatNum(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}
