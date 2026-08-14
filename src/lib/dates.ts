/**
 * Date helpers. The diary is keyed by ISO `yyyy-mm-dd` in local time.
 *
 * Weekday and month names come from the active language, so a date printed in
 * a report is worded in whichever language the user has chosen.
 */
import { currentStrings } from '../i18n/useLanguage';
import type { Strings } from '../i18n/strings';

/** Local-time ISO date, unlike `toISOString()` which shifts to UTC. */
export function isoDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** `31/07/2026` — the format written on the form, in every language. */
export function formatDdMmYyyy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** `יום שישי, 31/07/2026` · `الجمعة، 31/07/2026` · `Friday, 31/07/2026` */
export function formatLongDate(iso: string, strings: Strings = currentStrings()): string {
  const date = parseIso(iso);
  return strings.longDate(strings.weekdays[date.getDay()], formatDdMmYyyy(iso));
}

export function weekday(iso: string, strings: Strings = currentStrings()): string {
  return strings.weekdays[parseIso(iso).getDay()];
}

/** `יולי 2026` · `يوليو 2026` · `July 2026` */
export function monthLabel(iso: string, strings: Strings = currentStrings()): string {
  const date = parseIso(iso);
  return `${strings.months[date.getMonth()]} ${date.getFullYear()}`;
}

/** `yyyy-mm` bucket used to group the diary list by month. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** First and last ISO date of the month containing `iso`. */
export function monthRange(iso: string): { from: string; to: string } {
  const d = parseIso(iso);
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: isoDate(from), to: isoDate(to) };
}

export function addDays(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/**
 * A moment, short enough to sit inside a sentence: "02/08 14:31".
 *
 * Shared by the sync card and the backup line, which both answer the same kind
 * of question — how long has it been since this last happened.
 */
export function formatDateTime(stamp: number | null, locale: string): string | null {
  if (!stamp) return null;
  return new Date(stamp).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
