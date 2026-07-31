/** Saves the generated PDFs, through the native dialog when running as an app. */
import { saveAs } from 'file-saver';
import type { DiaryEntry, Project } from '../types';
import { entryFileName, rangeFileName } from '../docx/build';
import { buildEntryPdf, buildRangePdf, type BuildOptions } from './build';
import { saveBinary } from '../lib/save';
import { currentStrings } from '../i18n/useLanguage';

export async function exportEntryPdf(
  entry: DiaryEntry,
  project: Project,
  options: BuildOptions = {},
): Promise<string> {
  const t = options.strings ?? currentStrings();
  const bytes = await buildEntryPdf(entry, project, { ...options, strings: t });
  const name = `${entryFileName(entry, project, t)}.pdf`;
  await saveBinary(bytes, name, 'application/pdf');
  return name;
}

export async function exportRangePdf(
  entries: DiaryEntry[],
  project: Project,
  from: string,
  to: string,
  options: BuildOptions & { includeSummary?: boolean } = {},
): Promise<string> {
  const t = options.strings ?? currentStrings();
  const bytes = await buildRangePdf(entries, project, from, to, { ...options, strings: t });
  const name = `${rangeFileName(project, from, to, t)}.pdf`;
  await saveBinary(bytes, name, 'application/pdf');
  return name;
}

export { saveAs };
