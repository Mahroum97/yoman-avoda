/**
 * Generates filled samples of every export, without a browser.
 *
 *   npm run sample   ->  tmp/sample-entry.docx   tmp/sample-range.docx
 *                        tmp/sample-entry.pdf    tmp/sample-range.pdf
 *
 * Run it after touching anything under src/docx or src/pdf. To check the PDF
 * visually:  pdftoppm -r 150 -png tmp/sample-entry.pdf tmp/preview
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { Packer } from 'docx';
import { buildEntryDoc, buildRangeDoc } from '../src/docx/build';
import { buildContactsPdf, buildEntryPdf, buildRangePdf } from '../src/pdf/build';
import { buildRangeWorkbook } from '../src/xlsx/export';
import { LANGUAGES, STRINGS } from '../src/i18n/strings';
import type { DiaryEntry, Project } from '../src/types';

/* ------------------------------------------------- tiny PNG writer for fixtures */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Real RGB PNG, so the samples show actual artwork rather than a 1px dot. */
function makePng(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A handwriting-like squiggle on white, standing in for a real signature. */
const signaturePng = makePng(360, 120, (x, y) => {
  const wave = 60 + Math.sin(x / 22) * 26 + Math.sin(x / 7) * 6;
  const onStroke = Math.abs(y - wave) < 2.2 && x > 20 && x < 330;
  const tail = Math.abs(y - (95 - x / 14)) < 1.4 && x > 60 && x < 300;
  return onStroke || tail ? [16, 20, 26] : [255, 255, 255];
});

/** A site photo stand-in: sky, building mass, and a hi-vis stripe. */
const photoPng = makePng(640, 480, (x, y) => {
  if (y < 190) return [176 + Math.round(y / 8), 205, 230];
  if (y > 400) return [214, 118, 6];
  const band = Math.floor((x + y) / 60) % 2 === 0;
  return band ? [86, 98, 112] : [104, 117, 132];
});

const photoBytes = new Uint8Array(photoPng);

/** The same scene stood on its end: a phone photograph is usually portrait. */
const photoTallPng = makePng(480, 640, (x, y) => {
  if (y < 260) return [176 + Math.round(y / 12), 205, 230];
  if (y > 560) return [214, 118, 6];
  const band = Math.floor((x + y) / 60) % 2 === 0;
  return band ? [86, 98, 112] : [104, 117, 132];
});
const photoTallBytes = new Uint8Array(photoTallPng);

/**
 * Fifteen photos, which is more than one appendix page holds.
 *
 * The count is the point of the fixture: with eight to a page this is two
 * pages and a part-filled third, so the sample catches an appendix that draws
 * every photo on one page — which it did, printing the overflow past the
 * bottom edge — and a page count that disagrees with the pages produced.
 */
function samplePhotos(index: number): DiaryEntry['photos'] {
  return Array.from({ length: 15 }, (_, i) => ({
    id: `p${index}-${i + 1}`,
    caption: i === 0 ? 'תקרת קומה 3 לפני היציקה' : i === 1 ? 'משאבת הבטון בעמדת העבודה' : '',
    bytes: i % 3 === 0 ? photoTallBytes : photoBytes,
    width: i % 3 === 0 ? 480 : 640,
    height: i % 3 === 0 ? 640 : 480,
    takenAt: Date.now(),
  }));
}
const signatureDataUrl = `data:image/png;base64,${signaturePng.toString('base64')}`;

/** Company logo fixture — an amber block with a navy notch. */
const logoPng = makePng(240, 90, (x, y) => {
  const inNotch = x > 18 && x < 66 && y > 22 && y < 68;
  if (inNotch) return [15, 45, 74];
  return x < 84 ? [217, 119, 6] : [255, 255, 255];
});
const logoDataUrl = `data:image/png;base64,${logoPng.toString('base64')}`;

/* ---------------------------------------------------------------- fixtures */

const project: Project = {
  id: 1,
  name: 'מגדלי הים התיכון',
  address: 'רחוב הרצל 15, חיפה',
  company: 'מחרום בנייה והנדסה בע"מ',
  archived: false,
  createdAt: Date.now(),
};

function sampleEntry(date: string, index: number): DiaryEntry {
  return {
    id: index,
    projectId: 1,
    date,
    weather: 'בהיר, 31°C',
    management: [
      { id: 'm1', name: 'מוחמד מחרום', role: 'מנהל עבודה' },
      { id: 'm2', name: 'יוסי כהן', role: 'מפקח' },
      { id: 'm3', name: 'אחמד סאלח', role: 'ממונה בטיחות' },
    ],
    contractors: [
      { id: 'c1', trade: 'טפסנות', workers: '8' },
      { id: 'c2', trade: 'ברזלנות', workers: '6' },
      { id: 'c3', trade: 'אינסטלציה', workers: '2' },
      // Deliberately wider than the column: printed unbounded it ran across
      // the rule and into the column beside it.
      { id: 'c4', trade: 'אינסטלטור צוות ספרינקלרים', workers: '3' },
    ],
    equipment: [
      { id: 'e1', kind: 'מנוף צריח', qty: '1', hours: '9' },
      { id: 'e2', kind: 'מחפרון', qty: '2', hours: '7' },
      { id: 'e3', kind: 'משאבת בטון', qty: '1', hours: '4' },
    ],
    workDescription:
      'המשך יציקת תקרה קומה 3 באגף המזרחי. פירוק טפסות מקומה 2 והעברתן לקומה 3.\n' +
      'הנחת ברזל זיון בקורות היקפיות לפי תוכנית קונסטרוקציה 104-ב.\n' +
      'התקנת שרוולים לאינסטלציה סניטרית בתקרה לפני היציקה.\n' +
      'ניקיון כללי באתר ופינוי פסולת בניין בשתי מכולות.',
    casting: {
      description: 'תקרת קומה 3',
      sizeQty: '240 מ"ר',
      pump: 'משאבה 42 מ׳ — 4 שעות',
      concreteType: 'ב-30',
      concreteQty: '58',
      notes: 'הסתיימה 15:40, בוצעה ויברציה מלאה',
      notesConcreteType: 'ב-30 עם תוסף מאיץ',
    },
    supervisorNotes:
      'נבדק ברזל הזיון לפני היציקה ונמצא תקין. יש להקפיד על אשפרה במשך 7 ימים.\n' +
      'להשלים גידור בטיחות בפתח המדרגות עד מחר בבוקר.',
    receivedToday: '20 טון ברזל זיון קוטר 12, 3 משטחי בלוקים, 40 שקי צמנט',
    supervisorSignature: signatureDataUrl,
    managerSignature: signatureDataUrl,
    photos: samplePhotos(index),
    status: 'signed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/* -------------------------------------------------------------------- main */

async function main(): Promise<void> {
  await mkdir('tmp', { recursive: true });

  const fontBytes = {
    hebrew: {
      regular: (await readFile('src/assets/fonts/heebo-regular.ttf')).buffer as ArrayBuffer,
      bold: (await readFile('src/assets/fonts/heebo-bold.ttf')).buffer as ArrayBuffer,
    },
    arabic: {
      regular: (await readFile('src/assets/fonts/cairo-regular.ttf')).buffer as ArrayBuffer,
      bold: (await readFile('src/assets/fonts/cairo-bold.ttf')).buffer as ArrayBuffer,
    },
  };

  const entry = sampleEntry('2026-07-31', 1);

  // One page per language, so the three can be compared side by side.
  for (const language of LANGUAGES) {
    const strings = STRINGS[language];
    await writeFile(
      `tmp/sample-entry-${language}.pdf`,
      await buildEntryPdf(entry, project, { fontBytes, logoDataUrl, strings }),
    );
    await writeFile(
      `tmp/sample-entry-${language}.docx`,
      await Packer.toBuffer(await buildEntryDoc(entry, project, { strings })),
    );
  }

  await writeFile('tmp/sample-entry.docx', await Packer.toBuffer(await buildEntryDoc(entry, project)));
  await writeFile(
    'tmp/sample-entry.pdf',
    await buildEntryPdf(entry, project, { fontBytes, logoDataUrl }),
  );

  const week = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30'].map((date, i) =>
    sampleEntry(date, i + 1),
  );
  /*
   * One crowded day. A real diary lists every trade on the site, and this is
   * the shape that finds the two ways a page can overflow without saying so:
   * the day's own table growing past the blocks under it, and the trades tally
   * on the report's cover growing past the bottom of the cover.
   */
  week[3] = {
    ...week[3],
    contractors: [
      'טפסנות', 'ברזלנות', 'אינסטלציה', 'חשמל', 'טיח', 'גבס', 'ריצוף', 'איטום',
      'צביעה', 'אלומיניום', 'מסגרות', 'גינון', 'מיזוג אוויר', 'ספרינקלרים',
    ].map((trade, i) => ({ id: `x${i}`, trade, workers: String((i % 5) + 1) })),
  };

  // One sparse day, to prove an empty page still prints its ruled rows.
  week[1] = {
    ...week[1],
    management: [],
    contractors: [],
    equipment: [],
    workDescription: 'הפסקת עבודה בשל גשם.',
    casting: {
      description: '',
      sizeQty: '',
      pump: '',
      concreteType: '',
      concreteQty: '',
      notes: '',
      notesConcreteType: '',
    },
    photos: [],
    supervisorNotes: '',
    supervisorSignature: '',
    managerSignature: '',
    status: 'draft',
  };

  await writeFile(
    'tmp/sample-range.docx',
    await Packer.toBuffer(await buildRangeDoc(week, project, '2026-07-27', '2026-07-30', { includePhotos: true })),
  );
  await writeFile(
    'tmp/sample-range.pdf',
    await buildRangePdf(week, project, '2026-07-27', '2026-07-30', {
      fontBytes,
      logoDataUrl,
      includePhotos: true,
    }),
  );

  /*
   * Every box on the page given more than it was drawn for, in one document.
   *
   * The page is a grid of fixed boxes and the words that go in them are typed
   * by hand on a phone. Each of these was a real failure: a description longer
   * than thirteen ruled lines lost its last sentences without a mark, a trade
   * name wider than its column printed across the one beside it, and the
   * casting box's values ran out through its frame. Look at this page after
   * touching anything in `src/pdf/` — nothing may leave its box, and nothing
   * may be missing.
   */
  const long =
    'המשך עבודות אינסטלציה בדירות 1 עד 6 בקומות א׳ ו-ב׳, כולל פתיחת שרוולים, ' +
    'הנחת צנרת מים חמים וקרים, בדיקת לחץ ואיטום מעברים באש. במקביל התקדמו ' +
    'עבודות החשמל בלוחות הקומתיים והושלמה השחלת כבלים בשלושה גושים. ' +
    'צוות הגבס המשיך בהקמת מחיצות במסדרון המרכזי ובחדרי הרטוב, והושלמה ' +
    'סגירת תקרות בחלק המזרחי. הריצוף התחיל בדירה 2 לאחר השלמת השכבה המיישרת, ' +
    'ובוצע ניקיון כללי ופינוי פסולת בשתי מכולות. מנהל העבודה הנחה להשלים גידור ' +
    'בטיחות סביב פיר המעלית עד מחר בבוקר ולוודא שילוט אזהרה בכל הקומות.';

  await writeFile(
    'tmp/sample-stress.pdf',
    await buildEntryPdf(
      {
        ...sampleEntry('2026-07-31', 9),
        workDescription: long,
        supervisorNotes: long,
        receivedToday: long,
        casting: {
          description: 'תקרת קומה 3 באגף המזרחי כולל קורות היקפיות',
          sizeQty: '240 מ"ר · 58 מ"ק',
          pump: 'משאבה 42 מ׳ עם זרוע ארוכה — 4 שעות המתנה',
          concreteType: 'ב-30 עם תוסף מאיץ התקשרות',
          concreteQty: '58 מ"ק',
          notes: 'היציקה הסתיימה ב-15:40, בוצעה ויברציה מלאה בכל השטח',
          notesConcreteType: 'ב-30 עם תוסף מאיץ ומעכב התקשרות לפי הנחיית היועץ',
        },
      },
      {
        ...project,
        name: 'מגדלי הים התיכון — מתחם המזרחי, שלב ב׳',
        company: 'מחרום בנייה, הנדסה ותשתיות בע"מ',
        address: 'רחוב הרצל 15, קריית הממשלה, חיפה',
      },
      { fontBytes, logoDataUrl },
    ),
  );

  // ספקים וקבלנים. Two rows carry values long enough to wrap, because the row
  // height is computed from the wrapped cells and a fixed-height table would
  // look right here and clip on real data.
  const contacts = [
    ['אחמד סלים', 'טיח וגבס', '052-4471203', 'מגדלי הכרמל', 'עובד נקי, מגיע בזמן'],
    ['בטון הצפון בע"מ', 'משאבת בטון', '04-8123456', 'רמת ישי · מגדלי הכרמל', 'הזמנה יום מראש'],
    ['יוסי אלקטריק', 'חשמל', '054-9902288', 'שכונת רקפות', 'תעריף שעה 180 ₪'],
    [
      'חברת אלומיניום ומסגרות הצפון בע"מ',
      'מסגרות, אלומיניום וזכוכית',
      '077-2223344',
      'מגדלי הכרמל · רמת ישי · שכונת רקפות · פרויקט הדסה',
      'מחיר לפי מטר רץ, כולל התקנה והובלה. זמינות שבועיים מראש. שאל את דני.',
    ],
  ].map(([name, trade, phone, projects, notes], i) => ({
    uid: `c${i}`,
    name,
    trade,
    phone,
    projects,
    notes,
    createdAt: 0,
    updatedAt: 0,
  }));

  for (const lang of ['he', 'en'] as const) {
    await writeFile(
      `tmp/sample-contacts-${lang}.pdf`,
      await buildContactsPdf(contacts, {
        fontBytes,
        logoDataUrl,
        strings: STRINGS[lang],
        owner: 'מהרום בנייה בע"מ',
      }),
    );
  }

  // The spreadsheet, in both writing directions: the RTL flag changes the sheet
  // XML, so an LTR-only check would miss a broken Hebrew workbook.
  for (const lang of ['he', 'en'] as const) {
    const book = await buildRangeWorkbook(week, project, STRINGS[lang]);
    await writeFile(`tmp/sample-range-${lang}.xlsx`, Buffer.from(await book.arrayBuffer()));
  }

  console.log(
    'נוצרו: tmp/sample-entry.{docx,pdf}, tmp/sample-range.{docx,pdf,xlsx}, ' +
      'tmp/sample-contacts-{he,en}.pdf ' +
      `ובנוסף דף לכל שפה: ${LANGUAGES.map((l) => `sample-entry-${l}`).join(', ')}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
