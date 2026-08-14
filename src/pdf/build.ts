/**
 * Assembles PDF documents: a single diary page, a photo appendix, and the
 * multi-day report with its summary cover.
 *
 * The fonts are embedded from bundled TTFs, so the output is identical on every
 * machine and needs no network — see scripts/fetch-fonts.mjs.
 */
import { PDFDocument, type PDFImage, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Contact, DiaryEntry, Project } from '../types';
import type { Strings } from '../i18n/strings';
import { currentStrings } from '../i18n/useLanguage';
import { formatDdMmYyyy, formatLongDate } from '../lib/dates';
import { formatNum, summarise, type Tally } from '../docx/summary';
import { Painter, type Fonts } from './painter';
import {
  drawEntryPage,
  drawFooter,
  drawHeaderBand,
  sectionBar,
  type EntryImages,
  type PageChrome,
} from './entryPage';
import { drawContactsDocument } from './contactsPage';
import { CONTENT_W, METRICS, PAGE, TYPE, paletteFor } from './theme';
import { DEFAULT_DOC_THEME, docTheme } from '../docTheme';
import { docFontId } from '../fonts';

import heeboRegularUrl from '../assets/fonts/heebo-regular.ttf?url';
import heeboBoldUrl from '../assets/fonts/heebo-bold.ttf?url';
import cairoRegularUrl from '../assets/fonts/cairo-regular.ttf?url';
import cairoBoldUrl from '../assets/fonts/cairo-bold.ttf?url';
import assistantRegularUrl from '../assets/fonts/assistant-regular.ttf?url';
import assistantBoldUrl from '../assets/fonts/assistant-bold.ttf?url';
import rubikRegularUrl from '../assets/fonts/rubik-regular.ttf?url';
import rubikBoldUrl from '../assets/fonts/rubik-bold.ttf?url';
import frankRegularUrl from '../assets/fonts/frank-regular.ttf?url';
import frankBoldUrl from '../assets/fonts/frank-bold.ttf?url';
import cousineRegularUrl from '../assets/fonts/cousine-regular.ttf?url';
import cousineBoldUrl from '../assets/fonts/cousine-bold.ttf?url';
import tajawalRegularUrl from '../assets/fonts/tajawal-regular.ttf?url';
import tajawalBoldUrl from '../assets/fonts/tajawal-bold.ttf?url';

const LEFT = PAGE.margin;
const RIGHT = PAGE.margin + CONTENT_W;

export interface FontBytes {
  regular: ArrayBuffer;
  bold: ArrayBuffer;
}

/**
 * Every typeface the interface offers, as the TrueType a PDF can embed.
 *
 * Two go into each document — one carrying Hebrew + Latin, one Arabic + Latin —
 * so a Hebrew diary stays readable in an Arabic report. Which two is the user's
 * choice; the pair below is only what they default to.
 *
 * The files are fetched at export time rather than imported as bytes, so the
 * ones nobody chose are never downloaded on a phone.
 */
const FONT_URLS: Record<string, { regular: string; bold: string }> = {
  heebo: { regular: heeboRegularUrl, bold: heeboBoldUrl },
  assistant: { regular: assistantRegularUrl, bold: assistantBoldUrl },
  rubik: { regular: rubikRegularUrl, bold: rubikBoldUrl },
  frank: { regular: frankRegularUrl, bold: frankBoldUrl },
  cousine: { regular: cousineRegularUrl, bold: cousineBoldUrl },
  cairo: { regular: cairoRegularUrl, bold: cairoBoldUrl },
  tajawal: { regular: tajawalRegularUrl, bold: tajawalBoldUrl },
};

const fontCache = new Map<string, FontBytes>();

async function loadFontBytes(id: string): Promise<FontBytes> {
  const cached = fontCache.get(id);
  if (cached) return cached;
  const urls = FONT_URLS[id] ?? FONT_URLS.heebo;
  const [regular, bold] = await Promise.all([
    fetch(urls.regular).then((r) => r.arrayBuffer()),
    fetch(urls.bold).then((r) => r.arrayBuffer()),
  ]);
  const bytes = { regular, bold };
  fontCache.set(id, bytes);
  return bytes;
}

/** Node builds hand the bytes in directly; the browser fetches the bundled URL. */
export interface BuildOptions {
  /** Report language. Defaults to whatever the app is set to. */
  strings?: Strings;
  /** Keyed by script slot, for the Node sample generator. */
  fontBytes?: Partial<Record<'hebrew' | 'arabic', FontBytes>>;
  /**
   * Which typeface fills each slot. Defaults to what the user chose in
   * Settings, so an exported report is set in the same face as the app.
   */
  fonts?: Partial<Record<'hebrew' | 'arabic', string>>;
  /** Company logo as a PNG/JPEG data URL, shown in the header band. */
  logoDataUrl?: string;
  /** Which of the document colour themes to print in. */
  themeId?: string;
  includePhotos?: boolean;
}

async function prepare(options: BuildOptions) {
  const t = options.strings ?? currentStrings();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  // Both families go in, so mixed-script content always has a glyph to use.
  const [hebrewBytes, arabicBytes] = await Promise.all([
    options.fontBytes?.hebrew ?? loadFontBytes(options.fonts?.hebrew ?? docFontId('hebrew')),
    options.fontBytes?.arabic ?? loadFontBytes(options.fonts?.arabic ?? docFontId('arabic')),
  ]);
  const fonts: Fonts = {
    hebrew: {
      regular: await doc.embedFont(hebrewBytes.regular, { subset: true }),
      bold: await doc.embedFont(hebrewBytes.bold, { subset: true }),
    },
    arabic: {
      regular: await doc.embedFont(arabicBytes.regular, { subset: true }),
      bold: await doc.embedFont(arabicBytes.bold, { subset: true }),
    },
  };
  doc.setProducer(t.appName);
  doc.setCreator(t.appName);
  doc.setTitle(t.docWorkDiary);
  const colors = paletteFor(docTheme(options.themeId ?? DEFAULT_DOC_THEME));
  return { doc, fonts, t, dir: t.dir, colors };
}

async function embedDataUrl(
  doc: PDFDocument,
  dataUrl: string | undefined,
): Promise<PDFImage | undefined> {
  if (!dataUrl) return undefined;
  try {
    return dataUrl.includes('image/png')
      ? await doc.embedPng(dataUrl)
      : await doc.embedJpg(dataUrl);
  } catch {
    return undefined;
  }
}

async function embedBlob(doc: PDFDocument, blob: Blob): Promise<PDFImage | undefined> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return blob.type.includes('png') ? doc.embedPng(bytes) : doc.embedJpg(bytes);
  } catch {
    return undefined;
  }
}

const newPage = (doc: PDFDocument): PDFPage => doc.addPage([PAGE.width, PAGE.height]);

/* ---------------------------------------------------------- photo appendix */

async function drawPhotoPage(
  doc: PDFDocument,
  fonts: Fonts,
  entry: DiaryEntry,
  project: Project,
  chrome: PageChrome,
): Promise<void> {
  const page = newPage(doc);
  const p = new Painter(page, fonts, chrome.t.dir, chrome.colors);

  let y: number = PAGE.margin;
  y = drawHeaderBand(
    p,
    chrome.t.docPhotoAppendix,
    project.name,
    formatLongDate(entry.date, chrome.t),
    chrome,
    y,
  );
  y += METRICS.gap;

  const gap = 10;
  const colW = (CONTENT_W - gap) / 2;
  const slotH = 150;
  let col = 0;

  for (const [index, photo] of entry.photos.entries()) {
    const image = await embedBlob(doc, photo.blob);
    if (!image) continue;

    const x = col === 0 ? RIGHT - colW : LEFT;
    p.rect(x, y, colW, slotH + 18, {
      fill: p.colors.panel,
      stroke: p.colors.line,
      lineWidth: METRICS.hairline,
    });

    const scale = Math.min((colW - 12) / image.width, slotH / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    p.image(image, x + (colW - w) / 2, y + 6, w, h);
    p.textCentreBox(photo.caption || chrome.t.photoNumber(index + 1), x + colW / 2, y + slotH + 6, 12, {
      size: TYPE.tiny,
      color: p.colors.muted,
    });

    col += 1;
    if (col === 2) {
      col = 0;
      y += slotH + 18 + gap;
    }
  }

  drawFooter(p, project, chrome);
}

/* -------------------------------------------------------------- single day */

export async function buildEntryPdf(
  entry: DiaryEntry,
  project: Project,
  options: BuildOptions = {},
): Promise<Uint8Array> {
  const { doc, fonts, t, dir, colors } = await prepare(options);
  const includePhotos = (options.includePhotos ?? true) && entry.photos.length > 0;
  const photoPages = includePhotos ? Math.ceil(entry.photos.length / 4) : 0;
  const pageCount = 1 + photoPages;
  const generatedAt = new Date();

  const images: EntryImages = {
    supervisor: await embedDataUrl(doc, entry.supervisorSignature),
    manager: await embedDataUrl(doc, entry.managerSignature),
    logo: await embedDataUrl(doc, options.logoDataUrl),
  };

  const page = newPage(doc);
  drawEntryPage(new Painter(page, fonts, dir, colors), entry, project, images, {
    pageNumber: 1,
    pageCount,
    generatedAt,
    t,
    colors,
  });

  if (includePhotos) {
    await drawPhotoPage(doc, fonts, entry, project, {
      pageNumber: 2,
      pageCount,
      generatedAt,
      logo: images.logo,
      t,
      colors,
    });
  }

  return doc.save();
}

/* --------------------------------------------------------- ספקים וקבלנים */

export async function buildContactsPdf(
  contacts: Contact[],
  options: BuildOptions & { owner?: string } = {},
): Promise<Uint8Array> {
  const { doc, fonts, t, colors } = await prepare(options);
  drawContactsDocument(doc, fonts, contacts, {
    t,
    colors,
    logo: await embedDataUrl(doc, options.logoDataUrl),
    generatedAt: new Date(),
    owner: options.owner,
  });
  return doc.save();
}

/* ------------------------------------------------------------ range report */

function summaryTable(
  p: Painter,
  title: string,
  unit: string,
  rows: Tally[],
  t: Strings,
  top: number,
): number {
  if (rows.length === 0) return top;

  let y = sectionBar(p, title, top);
  const cols = [CONTENT_W * 0.5, CONTENT_W * 0.25, CONTENT_W * 0.25];
  const edges = [RIGHT, RIGHT - cols[0], RIGHT - cols[0] - cols[1]];
  const rowH = 16;

  p.rect(LEFT, y, CONTENT_W, rowH, { fill: p.colors.tintHead });
  [t.detail, unit, t.unitDays].forEach((label, i) => {
    p.textCentreBox(label, edges[i] - cols[i] / 2, y, rowH, {
      size: TYPE.column,
      bold: true,
      color: p.colors.navy,
    });
  });
  y += rowH;

  rows.forEach((row, index) => {
    if (index % 2 === 1) p.rect(LEFT, y, CONTENT_W, rowH, { fill: p.colors.tintRow });
    const values = [row.label, formatNum(row.total), String(row.days)];
    values.forEach((value, i) => {
      p.textCentreBox(value, edges[i] - cols[i] / 2, y, rowH, { size: TYPE.cell });
    });
    y += rowH;
    p.line(LEFT, y, RIGHT, y, { color: p.colors.lineSoft, width: METRICS.hairline });
  });

  const total = rows.reduce((sum, row) => sum + row.total, 0);
  p.rect(LEFT, y, CONTENT_W, rowH, { fill: p.colors.tintGroup });
  [t.total, formatNum(total), ''].forEach((value, i) => {
    p.textCentreBox(value, edges[i] - cols[i] / 2, y, rowH, {
      size: TYPE.cell,
      bold: true,
      color: p.colors.navy,
    });
  });
  y += rowH;

  p.rect(LEFT, top + METRICS.sectionBar, CONTENT_W, y - top - METRICS.sectionBar, {
    stroke: p.colors.line,
    lineWidth: METRICS.border,
  });
  return y + METRICS.gap;
}

function coverPage(
  p: Painter,
  project: Project,
  entries: DiaryEntry[],
  from: string,
  to: string,
  chrome: PageChrome,
): void {
  const t = chrome.t;
  const stats = summarise(entries);
  let y: number = PAGE.margin;
  y = drawHeaderBand(
    p,
    t.docCombinedReport,
    project.name,
    `${formatDdMmYyyy(from)} — ${formatDdMmYyyy(to)}`,
    chrome,
    y,
  );
  y += METRICS.gap;

  // Key figures strip.
  const figures: [string, string][] = [
    [t.statDiaryDays, String(stats.days)],
    [t.statActiveDays, String(stats.activeDays)],
    [t.statCastingDays, String(stats.castingDays)],
    [t.statConcreteTotal, formatNum(stats.concreteTotal)],
    [t.statSigned, `${stats.signedDays}/${stats.days}`],
  ];
  const gap = 6;
  const cardW = (CONTENT_W - gap * (figures.length - 1)) / figures.length;
  const cardH = 46;
  figures.forEach(([label, value], i) => {
    const x = RIGHT - cardW - i * (cardW + gap);
    p.rect(x, y, cardW, cardH, {
      fill: p.colors.panel,
      stroke: p.colors.line,
      lineWidth: METRICS.hairline,
    });
    p.rect(x, y, cardW, 2, { fill: p.colors.amber });
    p.textCentreBox(value, x + cardW / 2, y + 8, 20, {
      size: 15,
      bold: true,
      color: p.colors.navy,
    });
    p.textCentreBox(label, x + cardW / 2, y + 28, 12, {
      size: TYPE.label,
      color: p.colors.muted,
    });
  });
  y += cardH + METRICS.gap;

  const details: [string, string][] = [
    [t.labelAddress, project.address],
    [t.labelCompany, project.company],
    [t.docPhotosInReport, String(stats.photos)],
  ];
  p.rect(LEFT, y, CONTENT_W, 20 + details.length * 15, {
    fill: p.colors.panel,
    stroke: p.colors.line,
    lineWidth: METRICS.hairline,
  });
  let dy = y + 8;
  for (const [label, value] of details) {
    p.textRight(`${label}:`, RIGHT - 10, dy, {
      size: TYPE.label,
      bold: true,
      color: p.colors.navySoft,
    });
    const lw = p.width(`${label}:`, { size: TYPE.label, bold: true });
    p.textRight(value, RIGHT - 14 - lw, dy - 0.5, { size: TYPE.value });
    dy += 15;
  }
  y += 20 + details.length * 15 + METRICS.gap;

  y = summaryTable(p, t.summaryTrades, t.unitWorkers, stats.trades, t, y);
  y = summaryTable(p, t.summaryEquipment, t.unitHours, stats.equipment, t, y);
  summaryTable(p, t.summaryConcrete, t.unitCubicMetres, stats.concrete, t, y);
}

export async function buildRangePdf(
  entries: DiaryEntry[],
  project: Project,
  from: string,
  to: string,
  options: BuildOptions & { includeSummary?: boolean } = {},
): Promise<Uint8Array> {
  const { doc, fonts, t, dir, colors } = await prepare(options);
  const includePhotos = options.includePhotos ?? false;
  const includeSummary = options.includeSummary ?? true;
  const generatedAt = new Date();
  const logo = await embedDataUrl(doc, options.logoDataUrl);

  const photoPages = includePhotos
    ? entries.reduce((sum, e) => sum + (e.photos.length ? Math.ceil(e.photos.length / 4) : 0), 0)
    : 0;
  const pageCount = (includeSummary ? 1 : 0) + entries.length + photoPages || 1;
  let pageNumber = 1;

  if (includeSummary) {
    const page = newPage(doc);
    coverPage(new Painter(page, fonts, dir, colors), project, entries, from, to, {
      pageNumber,
      pageCount,
      generatedAt,
      logo,
      t,
      colors,
    });
    pageNumber += 1;
  }

  for (const entry of entries) {
    const images: EntryImages = {
      supervisor: await embedDataUrl(doc, entry.supervisorSignature),
      manager: await embedDataUrl(doc, entry.managerSignature),
      logo,
    };
    const page = newPage(doc);
    drawEntryPage(new Painter(page, fonts, dir, colors), entry, project, images, {
      pageNumber,
      pageCount,
      generatedAt,
      t,
      colors,
    });
    pageNumber += 1;

    if (includePhotos && entry.photos.length > 0) {
      await drawPhotoPage(doc, fonts, entry, project, {
        pageNumber,
        pageCount,
        generatedAt,
        logo,
        t,
        colors,
      });
      pageNumber += 1;
    }
  }

  if (doc.getPageCount() === 0) {
    const page = newPage(doc);
    const p = new Painter(page, fonts, dir, colors);
    p.textCenter(t.docNoEntries, PAGE.width / 2, 200, {
      size: TYPE.section,
      color: p.colors.muted,
    });
  }

  return doc.save();
}
