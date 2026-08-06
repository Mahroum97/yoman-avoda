/** Turns the built documents into a downloaded .docx file. */
import { Packer } from 'docx';
import type { DiaryEntry, Project } from '../types';
import { saveBlob, type ExportResult } from '../lib/save';
import { currentStrings } from '../i18n/useLanguage';
import { currentDocThemeId } from '../hooks/useDocTheme';
import { fileKind, logger } from '../lib/log';
import {
  buildEntryDoc,
  buildRangeDoc,
  entryFileName,
  rangeFileName,
  type EntryDocOptions,
  type RangeDocOptions,
} from './build';

const log = logger('word');

export async function exportEntry(
  entry: DiaryEntry,
  project: Project,
  options?: EntryDocOptions,
): Promise<ExportResult> {
  const t = options?.strings ?? currentStrings();
  const themeId = options?.themeId ?? (await currentDocThemeId());

  const done = log.time('build entry docx');
  log.debug('building entry docx', {
    date: entry.date,
    photos: entry.photos?.length ?? 0,
    lang: t.locale,
    theme: themeId,
  });

  try {
    const doc = await buildEntryDoc(entry, project, { ...options, strings: t, themeId });
    const blob = await Packer.toBlob(doc);
    done();
    const name = `${entryFileName(entry, project, t)}.docx`;
    log.info('entry docx ready', { kind: fileKind(name), bytes: blob.size });
    return (await saveBlob(blob, name)) ? name : null;
  } catch (error) {
    done('failed');
    log.error('entry docx failed', error);
    throw error;
  }
}

export async function exportRange(
  entries: DiaryEntry[],
  project: Project,
  from: string,
  to: string,
  options?: RangeDocOptions,
): Promise<ExportResult> {
  const t = options?.strings ?? currentStrings();
  const themeId = options?.themeId ?? (await currentDocThemeId());

  const done = log.time('build range docx');
  log.debug('building range docx', {
    days: entries.length,
    photos: entries.reduce((n, e) => n + (e.photos?.length ?? 0), 0),
    from,
    to,
    lang: t.locale,
    theme: themeId,
  });

  try {
    const doc = await buildRangeDoc(entries, project, from, to, {
      ...options,
      strings: t,
      themeId,
    });
    const blob = await Packer.toBlob(doc);
    done();
    const name = `${rangeFileName(project, from, to, t)}.docx`;
    log.info('range docx ready', { kind: fileKind(name), bytes: blob.size });
    return (await saveBlob(blob, name)) ? name : null;
  } catch (error) {
    done('failed');
    log.error('range docx failed', error);
    throw error;
  }
}
