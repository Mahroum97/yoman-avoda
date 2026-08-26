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
import { CONTENT_W, METRICS, PAGE, TYPE, axisFor, paletteFor } from './theme';
import { DEFAULT_DOC_THEME, docTheme } from '../docTheme';
import { PHOTOS_PER_PAGE, photoPageCount } from '../lib/photoPages';
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

/**
 * The appendix grid, in points.
 *
 * A tile is a fixed slot with the caption under it, two to a row. The slot
 * height is chosen so four rows clear the footer: the pagination and the page
 * count both come from that, rather than from a number written down twice.
 */
const PHOTO = {
  gap: 10,
  slotH: 146,
  captionH: 18,
  columns: 2,
} as const;

const PHOTO_ROW_H = PHOTO.slotH + PHOTO.captionH;
const PHOTO_TOP = PAGE.margin + METRICS.headerBand + METRICS.gap;
/** Clear of the footer rule — a tile drawn across it is a tile half off the page. */
const PHOTO_BOTTOM = PAGE.height - PAGE.margin - METRICS.footerBand - 8;

const PHOTO_ROWS = Math.max(
  1,
  Math.floor((PHOTO_BOTTOM - PHOTO_TOP + PHOTO.gap) / (PHOTO_ROW_H + PHOTO.gap)),
);

/*
 * The preview cannot import this module — it would pull pdf-lib into the app's
 * first load — so the capacity lives in `src/lib/photoPages.ts` and is checked
 * against the real geometry here. Change a height above and this throws until
 * the shared constant is changed with it, which is the whole point: a preview
 * that paginates differently from the document is a preview that lies.
 */
if (PHOTO_ROWS * PHOTO.columns !== PHOTOS_PER_PAGE) {
  throw new Error(
    `photo appendix fits ${PHOTO_ROWS * PHOTO.columns} per page, PHOTOS_PER_PAGE says ${PHOTOS_PER_PAGE}`,
  );
}

/**
 * The appendix for one day, as however many pages its photos need.
 *
 * Returns the number of pages drawn, so the caller can carry on numbering.
 * A photo whose bytes cannot be read leaves its slot in place with a line
 * saying so: dropping it silently would renumber everything after it and hide
 * the fault, and a hole in a grid is easier to ask about than a missing page.
 */
async function drawPhotoPages(
  doc: PDFDocument,
  fonts: Fonts,
  entry: DiaryEntry,
  project: Project,
  chrome: PageChrome,
): Promise<number> {
  const pages = photoPageCount(entry.photos.length);
  const axis = axisFor(chrome.t.dir);
  const colW = (CONTENT_W - PHOTO.gap) / PHOTO.columns;

  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const page = newPage(doc);
    const here: PageChrome = { ...chrome, pageNumber: chrome.pageNumber + pageIndex };
    const p = new Painter(page, fonts, here.t.dir, here.colors);

    drawHeaderBand(
      p,
      here.t.docPhotoAppendix,
      project.name,
      formatLongDate(entry.date, here.t),
      here,
      PAGE.margin,
    );

    const first = pageIndex * PHOTOS_PER_PAGE;
    const slice = entry.photos.slice(first, first + PHOTOS_PER_PAGE);

    for (const [slot, photo] of slice.entries()) {
      const col = slot % PHOTO.columns;
      const row = Math.floor(slot / PHOTO.columns);
      const x = axis.boxX(col * (colW + PHOTO.gap), colW);
      const y = PHOTO_TOP + row * (PHOTO_ROW_H + PHOTO.gap);

      p.rect(x, y, colW, PHOTO_ROW_H, {
        fill: p.colors.panel,
        stroke: p.colors.line,
        lineWidth: METRICS.hairline,
      });

      const image = await embedBlob(doc, photo.blob);
      if (image) {
        const scale = Math.min((colW - 12) / image.width, (PHOTO.slotH - 12) / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        p.image(image, x + (colW - w) / 2, y + 6 + (PHOTO.slotH - 12 - h) / 2, w, h);
      } else {
        p.textCentreBox(here.t.photoUnreadable, x + colW / 2, y, PHOTO.slotH, {
          size: TYPE.tiny,
          color: p.colors.muted,
        });
      }

      p.textCentreBox(
        photo.caption || here.t.photoNumber(first + slot + 1),
        x + colW / 2,
        y + PHOTO.slotH,
        PHOTO.captionH,
        { size: TYPE.tiny, color: p.colors.muted, maxWidth: colW - 10 },
      );
    }

    drawFooter(p, project, here);
  }

  return pages;
}

/* -------------------------------------------------------------- single day */

export async function buildEntryPdf(
  entry: DiaryEntry,
  project: Project,
  options: BuildOptions = {},
): Promise<Uint8Array> {
  const { doc, fonts, t, dir, colors } = await prepare(options);
  const includePhotos = (options.includePhotos ?? true) && entry.photos.length > 0;
  const photoPages = includePhotos ? photoPageCount(entry.photos.length) : 0;
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
    await drawPhotoPages(doc, fonts, entry, project, {
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

/** One of the three tallies printed under the figures on the cover. */
interface SummaryTable {
  title: string;
  unit: string;
  rows: Tally[];
}

const SUMMARY_ROW = 16;
/** Where the tables begin on the cover: under the band, figures and details. */
const COVER_TABLES_TOP =
  PAGE.margin + METRICS.headerBand + METRICS.gap + 46 + METRICS.gap + (20 + 3 * 15) + METRICS.gap;
/** Where they begin on a page that carries nothing but a band. */
const SUMMARY_TOP = PAGE.margin + METRICS.headerBand + METRICS.gap;
const SUMMARY_BOTTOM = PAGE.height - PAGE.margin - METRICS.footerBand - 8;

/** As much of one table as fits on one page. */
interface SummaryChunk {
  table: SummaryTable;
  from: number;
  to: number;
  /** Whether the totals row belongs to this chunk. */
  total: boolean;
}

/**
 * Splits the summary tables into pages before anything is drawn.
 *
 * A month of work brings fifteen trades and the three tables fit under the
 * figures; a quarter brings forty, and the rows ran off the bottom of the cover
 * and were simply not in the report. Planning first is also what lets the page
 * count in every header be right: it is known before the first page is drawn.
 *
 * A table is never left with its totals row alone on a page — the split takes
 * fewer rows instead — and never starts one with fewer than two rows under its
 * heading.
 */
function planSummary(tables: SummaryTable[]): SummaryChunk[][] {
  const pages: SummaryChunk[][] = [[]];
  let y = COVER_TABLES_TOP;

  const breakPage = () => {
    pages.push([]);
    y = SUMMARY_TOP;
  };

  for (const table of tables) {
    if (table.rows.length === 0) continue;
    const head = METRICS.sectionBar + SUMMARY_ROW;
    let index = 0;

    while (index < table.rows.length) {
      if (y + head + SUMMARY_ROW * 2 > SUMMARY_BOTTOM) breakPage();

      const room = Math.floor((SUMMARY_BOTTOM - y - head) / SUMMARY_ROW);
      const left = table.rows.length - index;
      const total = left + 1 <= room;
      const take = total ? left : room;

      pages[pages.length - 1].push({ table, from: index, to: index + take, total });
      y += head + SUMMARY_ROW * (take + (total ? 1 : 0)) + METRICS.gap;
      index += take;
    }
  }

  return pages;
}

/** Draws one chunk, and returns where the next one starts. */
function drawSummaryChunk(p: Painter, chunk: SummaryChunk, t: Strings, top: number): number {
  const { table } = chunk;
  let y = sectionBar(p, table.title, top);
  const cols = [CONTENT_W * 0.5, CONTENT_W * 0.25, CONTENT_W * 0.25];
  const edges = [RIGHT, RIGHT - cols[0], RIGHT - cols[0] - cols[1]];

  p.rect(LEFT, y, CONTENT_W, SUMMARY_ROW, { fill: p.colors.tintHead });
  [t.detail, table.unit, t.unitDays].forEach((label, i) => {
    p.textCentreBox(label, edges[i] - cols[i] / 2, y, SUMMARY_ROW, {
      size: TYPE.column,
      bold: true,
      color: p.colors.navy,
      maxWidth: cols[i] - 8,
    });
  });
  y += SUMMARY_ROW;

  for (let index = chunk.from; index < chunk.to; index += 1) {
    const row = table.rows[index];
    // Striped by its place in the whole table, so the banding carries on
    // across a break instead of restarting.
    if (index % 2 === 1) p.rect(LEFT, y, CONTENT_W, SUMMARY_ROW, { fill: p.colors.tintRow });
    [row.label, formatNum(row.total), String(row.days)].forEach((value, i) => {
      p.textCentreBox(value, edges[i] - cols[i] / 2, y, SUMMARY_ROW, {
        size: TYPE.cell,
        maxWidth: cols[i] - 8,
      });
    });
    y += SUMMARY_ROW;
    p.line(LEFT, y, RIGHT, y, { color: p.colors.lineSoft, width: METRICS.hairline });
  }

  if (chunk.total) {
    const total = table.rows.reduce((sum, row) => sum + row.total, 0);
    p.rect(LEFT, y, CONTENT_W, SUMMARY_ROW, { fill: p.colors.tintGroup });
    [t.total, formatNum(total), ''].forEach((value, i) => {
      p.textCentreBox(value, edges[i] - cols[i] / 2, y, SUMMARY_ROW, {
        size: TYPE.cell,
        bold: true,
        color: p.colors.navy,
        maxWidth: cols[i] - 8,
      });
    });
    y += SUMMARY_ROW;
  }

  p.rect(LEFT, top + METRICS.sectionBar, CONTENT_W, y - top - METRICS.sectionBar, {
    stroke: p.colors.line,
    lineWidth: METRICS.border,
  });
  return y + METRICS.gap;
}

/**
 * The cover's top half: the band, the five figures and the three details.
 *
 * Returns where the tables start, which is the constant the plan was made with.
 */
function coverHead(
  p: Painter,
  project: Project,
  stats: ReturnType<typeof summarise>,
  from: string,
  to: string,
  chrome: PageChrome,
): number {
  const t = chrome.t;
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
      maxWidth: cardW - 6,
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
    p.textRight(value, RIGHT - 14 - lw, dy - 0.5, {
      size: TYPE.value,
      maxWidth: CONTENT_W - 24 - lw,
    });
    dy += 15;
  }

  return COVER_TABLES_TOP;
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
    ? entries.reduce((sum, e) => sum + photoPageCount(e.photos.length), 0)
    : 0;

  const stats = summarise(entries);
  const plan = includeSummary
    ? planSummary([
        { title: t.summaryTrades, unit: t.unitWorkers, rows: stats.trades },
        { title: t.summaryEquipment, unit: t.unitHours, rows: stats.equipment },
        { title: t.summaryConcrete, unit: t.unitCubicMetres, rows: stats.concrete },
      ])
    : [];

  const pageCount = plan.length + entries.length + photoPages || 1;
  let pageNumber = 1;

  plan.forEach((chunks, index) => {
    const page = newPage(doc);
    const p = new Painter(page, fonts, dir, colors);
    const chrome: PageChrome = { pageNumber, pageCount, generatedAt, logo, t, colors };

    let y =
      index === 0
        ? coverHead(p, project, stats, from, to, chrome)
        : drawHeaderBand(
            p,
            t.docCombinedReport,
            project.name,
            `${formatDdMmYyyy(from)} — ${formatDdMmYyyy(to)}`,
            chrome,
            PAGE.margin,
          ) + METRICS.gap;

    for (const chunk of chunks) y = drawSummaryChunk(p, chunk, t, y);
    drawFooter(p, project, chrome);
    pageNumber += 1;
  });

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
      pageNumber += await drawPhotoPages(doc, fonts, entry, project, {
        pageNumber,
        pageCount,
        generatedAt,
        logo,
        t,
        colors,
      });
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
