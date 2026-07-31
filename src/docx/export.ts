/** Turns the built documents into a downloaded .docx file. */
import { Packer } from 'docx';
import type { DiaryEntry, Project } from '../types';
import { saveBlob } from '../lib/save';
import { currentStrings } from '../i18n/useLanguage';
import {
  buildEntryDoc,
  buildRangeDoc,
  entryFileName,
  rangeFileName,
  type EntryDocOptions,
  type RangeDocOptions,
} from './build';

export async function exportEntry(
  entry: DiaryEntry,
  project: Project,
  options?: EntryDocOptions,
): Promise<string> {
  const t = options?.strings ?? currentStrings();
  const doc = await buildEntryDoc(entry, project, { ...options, strings: t });
  const blob = await Packer.toBlob(doc);
  const name = `${entryFileName(entry, project, t)}.docx`;
  await saveBlob(blob, name);
  return name;
}

export async function exportRange(
  entries: DiaryEntry[],
  project: Project,
  from: string,
  to: string,
  options?: RangeDocOptions,
): Promise<string> {
  const t = options?.strings ?? currentStrings();
  const doc = await buildRangeDoc(entries, project, from, to, { ...options, strings: t });
  const blob = await Packer.toBlob(doc);
  const name = `${rangeFileName(project, from, to, t)}.docx`;
  await saveBlob(blob, name);
  return name;
}
