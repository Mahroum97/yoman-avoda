/**
 * The whole diary as documents, in one archive.
 *
 * The range report already covers "a period as one PDF", and the backup covers
 * "the data, to move to another device". Neither answers the request that keeps
 * coming up at the end of a job: hand over everything, as files a person can
 * open, without picking dates or exporting a page at a time.
 *
 * One folder per project, one PDF per day, and the spreadsheet beside them so
 * the totals are there without opening thirty documents.
 */
import type { DiaryEntry } from '../types';
import { db } from '../db';
import { currentStrings } from '../i18n/useLanguage';
import { currentDocThemeId } from '../hooks/useDocTheme';
import { formatDdMmYyyy } from './dates';
import { logger } from './log';

const log = logger('exportall');

export interface ExportAllProgress {
  /** Pages written so far. */
  done: number;
  /** Pages in total, across every project. */
  total: number;
  /** The project being written, for the line under the progress bar. */
  project: string;
}

export interface ExportAllResult {
  blob: Blob;
  name: string;
  projects: number;
  entries: number;
}

/** Keeps a project name usable as a folder name on any platform. */
const folderSafe = (name: string): string =>
  name.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim() || 'project';

export async function buildEverythingZip(
  onProgress?: (step: ExportAllProgress) => void,
  logoDataUrl?: string,
): Promise<ExportAllResult> {
  const t = currentStrings();
  const themeId = await currentDocThemeId();

  const [{ default: JSZip }, { buildEntryPdf }, { buildRangeWorkbook }] = await Promise.all([
    import('jszip'),
    import('../pdf/build'),
    import('../xlsx/export'),
  ]);

  const projects = await db.projects.toArray();
  const byProject = new Map<number, DiaryEntry[]>();
  let total = 0;
  for (const project of projects) {
    if (project.id === undefined) continue;
    // "Everything" means the diary, not the trash: a page thrown away should
    // not come back as a PDF in the handover archive.
    const rows = (await db.entries.where('projectId').equals(project.id).toArray())
      .filter((entry) => entry.deletedAt === undefined)
      .sort((a, b) => a.date.localeCompare(b.date));
    byProject.set(project.id, rows);
    total += rows.length;
  }

  if (total === 0) throw new Error('EMPTY');

  const done = log.time('build export-all zip');
  log.info('export all started', { projects: projects.length, entries: total });

  const zip = new JSZip();
  let written = 0;

  for (const project of projects) {
    if (project.id === undefined) continue;
    const rows = byProject.get(project.id) ?? [];
    if (rows.length === 0) continue;

    // A folder per project even when there is only one: the archive then says
    // what it holds without the name having to carry it.
    const folder = zip.folder(folderSafe(project.name))!;

    for (const entry of rows) {
      onProgress?.({ done: written, total, project: project.name });
      // Sequential on purpose. Every page carries its photos, and building a
      // month of them at once is how a phone runs out of memory.
      const bytes = await buildEntryPdf(entry, project, { strings: t, themeId, logoDataUrl });
      folder.file(`${formatDdMmYyyy(entry.date).replace(/\//g, '-')}.pdf`, bytes);
      written += 1;
    }

    // The totals for the whole project, so nobody has to add up the pages.
    const workbook = await buildRangeWorkbook(rows, project, t);
    folder.file(`${t.xlsxSummaryTitle}.xlsx`, workbook);
  }

  onProgress?.({ done: written, total, project: '' });

  // STORE, not DEFLATE: PDFs and xlsx files are already compressed, so
  // deflating them again costs seconds of a phone's time for almost nothing.
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  done();

  const name = `${folderSafe(t.exportAllFilePrefix)}-${formatDdMmYyyy(new Date().toISOString().slice(0, 10)).replace(/\//g, '-')}.zip`;
  log.info('export all ready', { entries: written, bytes: blob.size });

  return { blob, name, projects: projects.length, entries: written };
}
