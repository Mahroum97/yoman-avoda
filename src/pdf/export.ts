/** Saves the generated PDFs, through the native dialog when running as an app. */
import { saveAs } from 'file-saver';
import type { Contact, DiaryEntry, Project } from '../types';
import { entryFileName, rangeFileName } from '../docx/build';
import { buildContactsPdf, buildEntryPdf, buildRangePdf, type BuildOptions } from './build';
import { deliverBinary, deliverBlob, type Deliver, type ExportResult } from '../lib/save';
import { currentStrings } from '../i18n/useLanguage';
import { currentDocThemeId } from '../hooks/useDocTheme';
import { fileKind, logger } from '../lib/log';

const log = logger('pdf');

export async function exportEntryPdf(
  entry: DiaryEntry,
  project: Project,
  options: BuildOptions & { deliver?: Deliver } = {},
): Promise<ExportResult> {
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
    return (await deliverBinary(bytes, name, 'application/pdf', options.deliver)) ? name : null;
  } catch (error) {
    done('failed');
    log.error('entry pdf failed', error);
    throw error;
  }
}

/**
 * The supplier list as a document — the "print" button, in practice.
 *
 * A generated PDF rather than `window.print()`, for the reason the whole
 * document layer exists: a browser print puts its own header, its own URL and
 * its own page breaks on the paper, and on iOS it does nothing at all. The
 * share sheet this lands in has Print in it.
 */
export async function exportContactsPdf(
  contacts: Contact[],
  options: BuildOptions & { owner?: string; deliver?: Deliver } = {},
): Promise<ExportResult> {
  const t = options.strings ?? currentStrings();
  const themeId = options.themeId ?? (await currentDocThemeId());
  const done = log.time('build contacts pdf');
  log.debug('building contacts pdf', { rows: contacts.length, lang: t.locale, theme: themeId });

  try {
    const bytes = await buildContactsPdf(contacts, { ...options, strings: t, themeId });
    done();
    const name = `${t.contactsTitle}.pdf`;
    log.info('contacts pdf ready', { kind: fileKind(name), bytes: bytes.length });
    return (await deliverBinary(bytes, name, 'application/pdf', options.deliver)) ? name : null;
  } catch (error) {
    done('failed');
    log.error('contacts pdf failed', error);
    throw error;
  }
}

/**
 * The same page, as a picture.
 *
 * A day usually comes out as one image; with a photo appendix it is two, and a
 * range report is as many as it has pages. More than one is zipped rather than
 * handed over as a burst of separate files, which on a phone means the share
 * sheet opening once instead of once per page.
 */
export async function exportImage(
  bytes: Uint8Array,
  baseName: string,
  deliver: Deliver = 'save',
): Promise<ExportResult> {
  const done = log.time('render images');
  try {
    const { pdfToImages } = await import('./toImage');
    const images = await pdfToImages(bytes);
    done();

    if (images.length === 0) {
      log.warn('nothing to render as an image');
      return null;
    }

    if (images.length === 1) {
      const name = `${baseName}.jpg`;
      log.info('image ready', { kind: fileKind(name), bytes: images[0].size });
      return (await deliverBlob(images[0], name, deliver)) ? name : null;
    }

    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    images.forEach((blob, i) => {
      // Padded, so ten pages sort as 01..10 rather than 1, 10, 2 in a folder.
      zip.file(`${baseName}-${String(i + 1).padStart(2, '0')}.jpg`, blob);
    });
    const archive = await zip.generateAsync({ type: 'blob' });
    const name = `${baseName}.zip`;
    log.info('images ready', { kind: fileKind(name), pages: images.length, bytes: archive.size });
    return (await deliverBlob(archive, name, deliver)) ? name : null;
  } catch (error) {
    done('failed');
    log.error('rendering images failed', error);
    throw error;
  }
}

/** One diary page as a picture. */
export async function exportEntryImage(
  entry: DiaryEntry,
  project: Project,
  options: BuildOptions & { deliver?: Deliver } = {},
): Promise<ExportResult> {
  const t = options.strings ?? currentStrings();
  const themeId = options.themeId ?? (await currentDocThemeId());
  const bytes = await buildEntryPdf(entry, project, { ...options, strings: t, themeId });
  return exportImage(bytes, entryFileName(entry, project, t), options.deliver);
}

export async function exportRangePdf(
  entries: DiaryEntry[],
  project: Project,
  from: string,
  to: string,
  options: BuildOptions & { includeSummary?: boolean; deliver?: Deliver } = {},
): Promise<ExportResult> {
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
    return (await deliverBinary(bytes, name, 'application/pdf', options.deliver)) ? name : null;
  } catch (error) {
    done('failed');
    log.error('range pdf failed', error);
    throw error;
  }
}

export { saveAs };
export type { ExportResult };
