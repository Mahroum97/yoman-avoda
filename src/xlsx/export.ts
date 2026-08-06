/**
 * The diary as a spreadsheet.
 *
 * The PDF is the deliverable an inspector signs; this is the file a manager
 * filters and sums. That difference decides everything here: quantities are
 * written as **numbers** rather than as the free text the form carries, so a
 * column of workers actually adds up, and one row is one day so the sheet can
 * be sorted and filtered without unpicking merged cells.
 *
 * Two sheets — the days, and the same aggregates the range report prints.
 */
import type { DiaryEntry, Project } from '../types';
import type { Strings } from '../i18n/strings';
import { currentStrings } from '../i18n/useLanguage';
import { formatDdMmYyyy, weekday } from '../lib/dates';
import { summarise, parseNum } from '../docx/summary';
import { rangeFileName } from '../docx/build';
import { saveBlob, type ExportResult } from '../lib/save';
import { logger, fileKind } from '../lib/log';
import { buildWorkbook, type Cell, type Sheet } from './workbook';

const log = logger('xlsx');

/** Free text on the form; only the number is useful in a spreadsheet column. */
const num = (raw: string | undefined): Cell => {
  const value = parseNum(raw);
  return value > 0 ? value : null;
};

const list = (values: (string | undefined)[]): string =>
  values.map((v) => (v ?? '').trim()).filter(Boolean).join(', ');

function daysSheet(entries: DiaryEntry[], t: Strings): Sheet {
  const header = [
    t.labelDate,
    t.xlsxWeekday,
    t.labelWeather,
    t.labelWorkDescription,
    t.xlsxManagement,
    t.labelTrade,
    t.labelWorkers,
    t.labelEquipment,
    t.labelHours,
    t.labelConcreteType,
    t.xlsxConcreteQty,
    t.xlsxPhotos,
    t.xlsxStatus,
    t.labelReceivedToday,
    t.labelSupervisorNotes,
  ];

  const rows: Cell[][] = [header];

  for (const entry of entries) {
    const workers = (entry.contractors ?? []).reduce((sum, row) => sum + parseNum(row.workers), 0);
    const hours = (entry.equipment ?? []).reduce((sum, row) => sum + parseNum(row.hours), 0);

    rows.push([
      formatDdMmYyyy(entry.date),
      weekday(entry.date, t),
      entry.weather,
      // Excel shows only the first line of a multi-line cell in the grid; the
      // rest is still there when the cell is opened.
      (entry.workDescription ?? '').replace(/\r/g, ''),
      list((entry.management ?? []).map((row) => [row.name, row.role].filter(Boolean).join(' — '))),
      list((entry.contractors ?? []).map((row) => row.trade)),
      workers > 0 ? workers : null,
      list((entry.equipment ?? []).map((row) => row.kind)),
      hours > 0 ? hours : null,
      entry.casting?.concreteType ?? '',
      num(entry.casting?.concreteQty),
      entry.photos?.length ?? 0,
      entry.status === 'signed' ? t.statusSigned : t.statusDraft,
      (entry.receivedToday ?? '').replace(/\r/g, ''),
      (entry.supervisorNotes ?? '').replace(/\r/g, ''),
    ]);
  }

  return {
    name: t.xlsxSheetDays,
    rows,
    headerRows: 1,
    widths: [12, 10, 12, 46, 26, 20, 10, 20, 10, 14, 12, 8, 12, 30, 40],
  };
}

function summarySheet(entries: DiaryEntry[], project: Project, t: Strings): Sheet {
  const s = summarise(entries);
  const rows: Cell[][] = [[t.xlsxSummaryTitle, '', '']];

  const blank = () => rows.push(['', '', '']);
  const section = (title: string, columns: [string, string]) => {
    blank();
    rows.push([title, columns[0], columns[1]]);
  };

  rows.push([t.labelProjectName, project.name, '']);
  rows.push([t.labelAddress, project.address, '']);
  rows.push([t.labelCompany, project.company, '']);
  blank();
  rows.push([t.statDiaryDays, s.days, '']);
  rows.push([t.statActiveDays, s.activeDays, '']);
  rows.push([t.statCastingDays, s.castingDays, '']);
  rows.push([t.statConcreteTotal, s.concreteTotal, t.unitCubicMetres]);
  rows.push([t.statSigned, s.signedDays, '']);
  rows.push([t.statPhotos, s.photos, '']);

  section(t.summaryTrades, [t.unitWorkers, t.unitDays]);
  for (const row of s.trades) rows.push([row.label, row.total, row.days]);

  section(t.summaryEquipment, [t.unitHours, t.unitDays]);
  for (const row of s.equipment) rows.push([row.label, row.total, row.days]);

  section(t.summaryConcrete, [t.unitCubicMetres, t.unitDays]);
  for (const row of s.concrete) rows.push([row.label, row.total, row.days]);

  return { name: t.xlsxSheetSummary, rows, headerRows: 1, widths: [30, 16, 12] };
}

/**
 * The workbook itself, without saving it.
 *
 * Split out so `npm run sample` can build one in Node and check it opens —
 * `exportRangeXlsx` cannot be run there because saving needs a browser.
 */
export async function buildRangeWorkbook(
  entries: DiaryEntry[],
  project: Project,
  t: Strings,
): Promise<Blob> {
  // Oldest first: a spreadsheet is read downwards.
  const ordered = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  return buildWorkbook([daysSheet(ordered, t), summarySheet(ordered, project, t)], t.dir === 'rtl');
}

export async function exportRangeXlsx(
  entries: DiaryEntry[],
  project: Project,
  from: string,
  to: string,
  options: { strings?: Strings } = {},
): Promise<ExportResult> {
  const t = options.strings ?? currentStrings();
  const done = log.time('build xlsx');
  log.debug('building xlsx', { days: entries.length, lang: t.locale });

  try {
    const blob = await buildRangeWorkbook(entries, project, t);
    done();

    const name = `${rangeFileName(project, from, to, t)}.xlsx`;
    log.info('xlsx ready', { kind: fileKind(name), bytes: blob.size });
    return (await saveBlob(blob, name)) ? name : null;
  } catch (error) {
    done('failed');
    log.error('xlsx failed', error);
    throw error;
  }
}
