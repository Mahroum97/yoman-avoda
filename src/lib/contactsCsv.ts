/**
 * ספקים וקבלנים, out to a file and back in again.
 *
 * CSV rather than the app's own JSON, because the answer to "send me your
 * supplier list" is a file the other person can open — and CSV is the one
 * format Excel, Numbers, Google Sheets and every phone can all read and write.
 * The same file goes back in, so a list can be edited in a spreadsheet and
 * returned, or carried from another device without syncing.
 *
 * Two things about that round trip are easy to get wrong and are handled here:
 *
 *  - **Excel needs a byte-order mark** or it reads a UTF-8 file as the local
 *    8-bit codepage, and every Hebrew name arrives as mojibake. The BOM is
 *    three bytes that cost nothing and are stripped again on the way in.
 *  - **Columns are matched by their heading when there is one**, so a file
 *    exported in Hebrew still imports into an app running in English, and a
 *    hand-made file with just a name and a phone works too. Position is only
 *    the fallback.
 */
import type { Contact } from '../types';
import { LANGUAGES, STRINGS } from '../i18n/strings';

/** The columns, in the order the printed list and the spreadsheet use. */
export const CSV_FIELDS = ['name', 'trade', 'phone', 'projects', 'notes'] as const;
export type CsvField = (typeof CSV_FIELDS)[number];

/** One row as it arrives from a file: every field optional, all of them strings. */
export type CsvRow = Partial<Record<CsvField, string>>;

/* --------------------------------------------------------------------- out */

/** Quotes a value only when it has to be — a quoted column of names is noise. */
function cell(value: string): string {
  const text = value ?? '';
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function contactsToCsv(
  contacts: Contact[],
  labels: { no: string; name: string; trade: string; phone: string; projects: string; notes: string },
): string {
  const header = [labels.no, labels.name, labels.trade, labels.phone, labels.projects, labels.notes];
  const rows = contacts.map((contact, index) =>
    [
      String(index + 1),
      contact.name,
      contact.trade,
      contact.phone,
      contact.projects,
      contact.notes,
    ].map(cell).join(','),
  );
  // \r\n: the line ending every spreadsheet on every platform accepts.
  return `﻿${header.map(cell).join(',')}\r\n${rows.join('\r\n')}\r\n`;
}

/* ---------------------------------------------------------------------- in */

/**
 * A CSV reader that understands quoting.
 *
 * Small enough to be worth writing: a note can hold a comma, a line break or a
 * quotation mark, and a split on commas turns any of those into a broken row —
 * silently, halfway down someone's supplier list.
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r') {
      // Swallowed; the \n that follows ends the row.
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * Every heading this app has ever printed for a column, in every language it
 * speaks, mapped back to the field it names. Built from the dictionary rather
 * than written out again, so a translation that changes cannot drift from this.
 */
function headingIndex(): Map<string, CsvField> {
  const index = new Map<string, CsvField>();
  const put = (label: string, field: CsvField) => {
    const key = label.trim().toLowerCase();
    if (key) index.set(key, field);
  };
  for (const language of LANGUAGES) {
    const t = STRINGS[language];
    put(t.labelContactName, 'name');
    put(t.labelContactTrade, 'trade');
    put(t.labelContactPhone, 'phone');
    put(t.labelContactProjects, 'projects');
    put(t.labelContactNotes, 'notes');
  }
  // The plain English words a hand-made file is most likely to use.
  put('name', 'name');
  put('supplier', 'name');
  put('contractor', 'name');
  put('trade', 'trade');
  put('field', 'trade');
  put('phone', 'phone');
  put('tel', 'phone');
  put('mobile', 'phone');
  put('project', 'projects');
  put('projects', 'projects');
  put('notes', 'notes');
  put('note', 'notes');
  return index;
}

/** Where each field sits, read from a header row — or null if that is not one. */
function mapHeader(cells: string[]): Partial<Record<CsvField, number>> | null {
  const index = headingIndex();
  const map: Partial<Record<CsvField, number>> = {};
  let hits = 0;
  cells.forEach((raw, column) => {
    const field = index.get(raw.trim().toLowerCase());
    if (field && map[field] === undefined) {
      map[field] = column;
      hits += 1;
    }
  });
  // One recognised word could be a supplier called "Notes". Two is a header.
  return hits >= 2 ? map : null;
}

/**
 * Positional fallback, for a file with no header.
 *
 * Six columns is the shape this app exports, whose first column is a serial
 * number; five is the same list without it. Anything else is read as
 * name-first, which is the only ordering a person writing a list by hand uses.
 */
function positionalMap(width: number): Partial<Record<CsvField, number>> {
  const offset = width >= 6 ? 1 : 0;
  return {
    name: offset,
    trade: offset + 1,
    phone: offset + 2,
    projects: offset + 3,
    notes: offset + 4,
  };
}

export function csvToContacts(text: string): CsvRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = mapHeader(rows[0]);
  const map = header ?? positionalMap(rows[0].length);
  const body = header ? rows.slice(1) : rows;

  const at = (cells: string[], field: CsvField): string => {
    const column = map[field];
    return column === undefined ? '' : (cells[column] ?? '').trim();
  };

  return body
    .map((cells) => ({
      name: at(cells, 'name'),
      trade: at(cells, 'trade'),
      phone: at(cells, 'phone'),
      projects: at(cells, 'projects'),
      notes: at(cells, 'notes'),
    }))
    // A line with nothing on it is not a supplier.
    .filter((row) => Object.values(row).some((value) => value !== ''));
}
