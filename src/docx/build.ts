/**
 * Assembles Word documents from diary entries.
 *
 * Each diary page is its own document section, which is what makes Word start
 * the next day on a fresh sheet without stray empty paragraphs.
 */
import {
  AlignmentType,
  Document,
  HeightRule,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  VerticalAlign,
  WidthType,
  type ISectionOptions,
} from 'docx';
import type { DiaryEntry, Project } from '../types';
import type { Strings } from '../i18n/strings';
import { currentStrings } from '../i18n/useLanguage';
import { DEFAULT_DOC_THEME, docTheme } from '../docTheme';
import { formatDdMmYyyy } from '../lib/dates';
import { blobToUint8 } from '../lib/images';
import { CELL_MARGIN, bar, labelledLine } from './blocks';
import { entryPage, photoAppendix } from './entryPage';
import { summarise, formatNum, type Tally } from './summary';
import {
  CONTENT_WIDTH,
  FILL,
  FONT,
  INK,
  PAGE,
  SIZE,
  THIN,
  blankPara,
  boxBorders,
  framedBorders,
  hePara,
  isRtl,
  setDocDirection,
  setDocPalette,
} from './theme';

const pageProperties: ISectionOptions['properties'] = {
  page: {
    size: { width: PAGE.widthTwips, height: PAGE.heightTwips },
    margin: {
      top: PAGE.margin,
      right: PAGE.margin,
      bottom: PAGE.margin,
      left: PAGE.margin,
    },
  },
};

/** Photo blobs must be read before the (synchronous) document build. */
async function loadPhotos(entries: DiaryEntry[]): Promise<Map<string, Uint8Array>> {
  const images = new Map<string, Uint8Array>();
  await Promise.all(
    entries.flatMap((entry) =>
      entry.photos.map(async (photo) => {
        images.set(photo.id, await blobToUint8(photo.blob));
      }),
    ),
  );
  return images;
}

function documentOf(sections: ISectionOptions[]): Document {
  return new Document({
    // Word falls back to this for anything the runs do not set explicitly.
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE.cell },
          paragraph: { spacing: { after: 0, line: 240 } },
        },
      },
    },
    sections,
  });
}

export interface EntryDocOptions {
  includePhotos?: boolean;
  /** Report language. Defaults to whatever the app is set to. */
  strings?: Strings;
  /** Which of the document colour themes to print in. */
  themeId?: string;
}

/** A single diary page, plus its photo appendix. */
export async function buildEntryDoc(
  entry: DiaryEntry,
  project: Project,
  options: EntryDocOptions = {},
): Promise<Document> {
  const t = options.strings ?? currentStrings();
  setDocDirection(t.dir);
  setDocPalette(docTheme(options.themeId ?? DEFAULT_DOC_THEME));
  const includePhotos = options.includePhotos ?? true;
  const images = includePhotos ? await loadPhotos([entry]) : new Map();
  const sections: ISectionOptions[] = [
    { properties: pageProperties, children: entryPage(entry, project, t) },
  ];
  if (includePhotos && entry.photos.length > 0) {
    sections.push({
      properties: pageProperties,
      children: photoAppendix(entry, t, images),
    });
  }
  return documentOf(sections);
}

/* ------------------------------------------------------------ range report */

function summaryTable(
  title: string,
  unit: string,
  rows: Tally[],
  t: Strings,
): (Table | Paragraph)[] {
  if (rows.length === 0) return [];

  const columns = [Math.round(CONTENT_WIDTH * 0.5), Math.round(CONTENT_WIDTH * 0.25)];
  const widths = [columns[0], columns[1], CONTENT_WIDTH - columns[0] - columns[1]];

  const cell = (text: string, width: number, bold = false) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      margins: CELL_MARGIN,
      borders: boxBorders(THIN),
      children: [hePara(text, { bold, align: AlignmentType.CENTER })],
    });

  const total = rows.reduce((sum, row) => sum + row.total, 0);

  return [
    blankPara(),
    bar(title, {
      size: SIZE.groupHeader,
      height: 400,
      fill: FILL.tintHead,
      color: INK.navy,
    }),
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      visuallyRightToLeft: isRtl(),
      borders: framedBorders(),
      rows: [
        new TableRow({
          tableHeader: true,
          height: { value: 360, rule: HeightRule.ATLEAST },
          children: [
            cell(t.detail, widths[0], true),
            cell(unit, widths[1], true),
            cell(t.unitDays, widths[2], true),
          ],
        }),
        ...rows.map(
          (row) =>
            new TableRow({
              height: { value: 320, rule: HeightRule.ATLEAST },
              children: [
                cell(row.label, widths[0]),
                cell(formatNum(row.total), widths[1]),
                cell(String(row.days), widths[2]),
              ],
            }),
        ),
        new TableRow({
          height: { value: 340, rule: HeightRule.ATLEAST },
          children: [
            cell(t.total, widths[0], true),
            cell(formatNum(total), widths[1], true),
            cell('', widths[2]),
          ],
        }),
      ],
    }),
  ];
}

function coverPage(
  project: Project,
  entries: DiaryEntry[],
  from: string,
  to: string,
  t: Strings,
): (Table | Paragraph)[] {
  const stats = summarise(entries);
  const half = Math.floor(CONTENT_WIDTH / 2);

  const facts: [string, string][] = [
    [t.labelProjectName, project.name],
    [t.labelAddress, project.address],
    [t.labelCompany, project.company],
    [t.docReportPeriod, `${formatDdMmYyyy(from)} — ${formatDdMmYyyy(to)}`],
    [t.statDiaryDays, String(stats.days)],
    [t.statActiveDays, String(stats.activeDays)],
    [t.statCastingDays, String(stats.castingDays)],
    [t.statConcreteTotal, formatNum(stats.concreteTotal)],
    [t.statSigned, `${stats.signedDays} / ${stats.days}`],
    [t.docPhotosInReport, String(stats.photos)],
  ];

  return [
    bar(`${t.docWorkDiary} — ${t.docCombinedReport}`, {
      size: SIZE.title,
      height: 620,
      fill: FILL.navy,
      color: INK.white,
    }),
    blankPara(),
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [CONTENT_WIDTH],
      layout: TableLayoutType.FIXED,
      visuallyRightToLeft: isRtl(),
      borders: framedBorders(),
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: CONTENT_WIDTH, type: WidthType.DXA },
              margins: { top: 160, bottom: 160, left: 200, right: 200 },
              borders: boxBorders(THIN),
              children: facts.map(([label, value]) =>
                labelledLine(label, value, CONTENT_WIDTH - 500, half - 1400),
              ),
            }),
          ],
        }),
      ],
    }),
    ...summaryTable(t.summaryTrades, t.unitWorkers, stats.trades, t),
    ...summaryTable(t.summaryEquipment, t.unitHours, stats.equipment, t),
    ...summaryTable(t.summaryConcrete, t.unitCubicMetres, stats.concrete, t),
  ];
}

export interface RangeDocOptions {
  includePhotos?: boolean;
  includeSummary?: boolean;
  strings?: Strings;
  themeId?: string;
}

/** Cover + summaries + one page per diary day over the selected period. */
export async function buildRangeDoc(
  entries: DiaryEntry[],
  project: Project,
  from: string,
  to: string,
  options: RangeDocOptions = {},
): Promise<Document> {
  const t = options.strings ?? currentStrings();
  setDocDirection(t.dir);
  setDocPalette(docTheme(options.themeId ?? DEFAULT_DOC_THEME));
  const includePhotos = options.includePhotos ?? false;
  const includeSummary = options.includeSummary ?? true;
  const images = includePhotos ? await loadPhotos(entries) : new Map();

  const sections: ISectionOptions[] = [];
  if (includeSummary) {
    sections.push({
      properties: pageProperties,
      children: coverPage(project, entries, from, to, t),
    });
  }

  for (const entry of entries) {
    sections.push({ properties: pageProperties, children: entryPage(entry, project, t) });
    if (includePhotos && entry.photos.length > 0) {
      sections.push({
        properties: pageProperties,
        children: photoAppendix(entry, t, images),
      });
    }
  }

  if (sections.length === 0) {
    sections.push({
      properties: pageProperties,
      children: [
        hePara(t.docNoEntries, {
          size: SIZE.section,
          align: AlignmentType.CENTER,
        }),
      ],
    });
  }

  return documentOf(sections);
}

/** `יומן-מגדלי הים-30-07-2026` — safe on every OS, readable in Hebrew. */
export function entryFileName(
  entry: DiaryEntry,
  project: Project,
  t: Strings = currentStrings(),
): string {
  return sanitise(
    `${t.fileEntryPrefix}-${project.name}-${formatDdMmYyyy(entry.date).replace(/\//g, '-')}`,
  );
}

export function rangeFileName(
  project: Project,
  from: string,
  to: string,
  t: Strings = currentStrings(),
): string {
  const part = (iso: string) => formatDdMmYyyy(iso).replace(/\//g, '-');
  return sanitise(
    `${t.fileReportPrefix}-${project.name}-${part(from)}-${t.fileUntil}-${part(to)}`,
  );
}

function sanitise(name: string): string {
  return name.replace(/["*/:<>?\\|]+/g, '').replace(/\s+/g, ' ').trim();
}
