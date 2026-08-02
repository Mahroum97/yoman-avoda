/**
 * A minimal .xlsx writer.
 *
 * An xlsx is a zip of XML parts, and writing those parts directly is a few
 * hundred lines — far less than pulling in a spreadsheet library, and it buys
 * the one thing a generic library will not give: **right-to-left sheets**.
 * `<sheetView rightToLeft="1"/>` is what puts column A on the right, and
 * without it a Hebrew or Arabic report opens mirrored, with the dates on the
 * wrong side of the sheet.
 *
 * Numbers are written as numbers, not as text, so the totals row of a
 * spreadsheet actually sums — which is the entire reason for exporting to
 * Excel rather than to a PDF.
 *
 * jszip is already in the tree (docx builds on it) and is declared as a direct
 * dependency here rather than borrowed from docx's own.
 */

export type Cell = string | number | null | undefined;

export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Column widths in characters; missing entries fall back to a default. */
  widths?: number[];
  /** How many leading rows are headings, styled bold and frozen. */
  headerRows?: number;
}

const DEFAULT_WIDTH = 16;

/** XML text escaping. `&` first, or the other replacements get re-escaped. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Excel refuses to open a file carrying raw control characters, and text
    // pasted into a description can. Tab, newline and carriage return are the
    // three that XML actually permits, so those are kept. Matching control
    // characters is the entire point here, so the rule is waived rather than
    // the pattern weakened.
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** 0-based column index to a spreadsheet letter: 0 → A, 26 → AA. */
function columnName(index: number): string {
  let name = '';
  let n = index;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

function cellXml(cell: Cell, ref: string, styleId: number): string {
  const style = styleId ? ` s="${styleId}"` : '';
  if (cell === null || cell === undefined || cell === '') {
    return `<c r="${ref}"${style}/>`;
  }
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    return `<c r="${ref}"${style}><v>${cell}</v></c>`;
  }
  // Inline strings rather than a shared-strings table: a diary has few enough
  // rows that the table would cost more code than it saves bytes.
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(String(cell))}</t></is></c>`;
}

function sheetXml(sheet: Sheet, rtl: boolean): string {
  const headerRows = sheet.headerRows ?? 1;
  const columns = Math.max(1, ...sheet.rows.map((row) => row.length));

  const cols =
    `<cols>` +
    Array.from({ length: columns }, (_, i) => {
      const width = sheet.widths?.[i] ?? DEFAULT_WIDTH;
      return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
    }).join('') +
    `</cols>`;

  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => cellXml(cell, `${columnName(c)}${r + 1}`, r < headerRows ? 1 : 0))
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');

  // Freezing the headings keeps them visible while scrolling a month of days.
  const frozen =
    headerRows > 0
      ? `<pane ySplit="${headerRows}" topLeftCell="A${headerRows + 1}" activePane="bottomLeft" state="frozen"/>`
      : '';

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ''}>${frozen}</sheetView></sheetViews>` +
    cols +
    `<sheetData>${rows}</sheetData>` +
    `</worksheet>`
  );
}

/** Two styles: 0 is plain, 1 is the bold heading on a tinted fill. */
const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2">` +
  `<font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
  `</fonts>` +
  `<fills count="3">` +
  `<fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF0F2D4A"/><bgColor indexed="64"/></patternFill></fill>` +
  `</fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
  `</cellXfs>` +
  `</styleSheet>`;

export async function buildWorkbook(sheets: Sheet[], rtl: boolean): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('') +
      `</Types>`,
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );

  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>` +
      sheets
        .map(
          (sheet, i) =>
            // Sheet names cannot exceed 31 characters or contain : \ / ? * [ ]
            `<sheet name="${esc(sheet.name.slice(0, 31).replace(/[:\\/?*[\]]/g, ' '))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join('') +
      `</sheets>` +
      `</workbook>`,
  );

  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  );

  zip.file('xl/styles.xml', STYLES_XML);
  sheets.forEach((sheet, i) => {
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet, rtl));
  });

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
  });
}
