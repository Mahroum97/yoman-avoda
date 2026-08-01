/** Saves the generated PDFs, through the native dialog when running as an app. */
import { saveAs } from 'file-saver';
import type { DiaryEntry, Project } from '../types';
import { entryFileName, rangeFileName } from '../docx/build';
import { buildEntryPdf, buildRangePdf, type BuildOptions } from './build';
import { saveBinary } from '../lib/save';
import { currentStrings } from '../i18n/useLanguage';
import { currentDocThemeId } from '../hooks/useDocTheme';
import { fileKind, logger } from '../lib/log';

const log = logger('pdf');

export async function exportEntryPdf(
  entry: DiaryEntry,
  project: Project,
  options: BuildOptions = {},
): Promise<string> {
  const t = options.strings ?? currentStrings();
  const themeId = options.themeId ?? (await currentDocThemeId());

  // Counts and sizes only — never the descriptions or the names on the page.
  const done = log.time('build entry pdf');
  log.debug('building entry pdf', {
    date: entry.date,
    photos: entry.photos?.length ?? 0,
    lang: t.locale,
    theme: themeId,
  });

  try {
    const bytes = await buildEntryPdf(entry, project, { ...options, strings: t, themeId });
    done();
    const name = `${entryFileName(entry, project, t)}.pdf`;
    log.info('entry pdf ready', { kind: fileKind(name), bytes: bytes.length });
    await saveBinary(bytes, name, 'application/pdf');
    return name;
  } catch (error) {
    done('failed');
    log.error('entry pdf failed', error);
    throw error;
  }
}

export async function exportRangePdf(
  entries: DiaryEntry[],
  project: Project,
  from: string,
  to: string,
  options: BuildOptions & { includeSummary?: boolean } = {},
): Promise<string> {
  const t = options.strings ?? currentStrings();
  const themeId = options.themeId ?? (await currentDocThemeId());

  // A range report is the slow one — every page and every photo in one file —
  // so this is the timing that matters when the app appears to freeze.
  const done = log.time('build range pdf');
  log.debug('building range pdf', {
    days: entries.length,
    photos: entries.reduce((n, e) => n + (e.photos?.length ?? 0), 0),
    from,
    to,
    lang: t.locale,
    theme: themeId,
  });

  try {
    const bytes = await buildRangePdf(entries, project, from, to, {
      ...options,
      strings: t,
      themeId,
    });
    done();
    const name = `${rangeFileName(project, from, to, t)}.pdf`;
    log.info('range pdf ready', { kind: fileKind(name), bytes: bytes.length });
    await saveBinary(bytes, name, 'application/pdf');
    return name;
  } catch (error) {
    done('failed');
    log.error('range pdf failed', error);
    throw error;
  }
}

export { saveAs };
