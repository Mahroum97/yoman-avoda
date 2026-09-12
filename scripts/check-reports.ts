/** Synthetic report regressions. No diary database is opened. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';
import { Packer } from 'docx';
import { PDFDocument } from 'pdf-lib';
import { addDays, isoDate, shiftedMonthRange } from '../src/lib/dates';
import { emptyCasting, type DiaryEntry, type Project } from '../src/types';
import { summaryGroups } from '../src/lib/summaryReport';
import { buildSummaryPdf, buildRangePdf } from '../src/pdf/build';
import { buildEntryDoc } from '../src/docx/build';
import { buildSummaryWorkbook } from '../src/xlsx/summaryReport';
import { buildRangeWorkbook } from '../src/xlsx/export';
import { STRINGS } from '../src/i18n/strings';
import { parseNum } from '../src/docx/summary';

const project: Project = { uid: 'synthetic-project', id: 1, name: 'QA project', company: 'QA', address: 'QA street', archived: false, createdAt: 1 };
const makeEntry = (date: string, changes: Partial<DiaryEntry> = {}): DiaryEntry => ({
  uid: date, projectUid: project.uid, projectId: 1, date, weather: '', management: [], contractors: [],
  equipment: [], casting: emptyCasting(), photos: [], workDescription: 'PRIVATE-DIARY-TEXT',
  supervisorNotes: 'PRIVATE-SUPERVISOR', supervisorSignature: '', managerSignature: '', status: 'draft',
  createdAt: 1, updatedAt: 1, ...changes,
});
await mkdir('tmp', { recursive: true });
assert.equal(parseNum('١٢٫٥ م³'), 12.5);
assert.equal(parseNum('۱۲'), 12);
assert.equal(parseNum('١٬٢٣٤٫٥'), 1234.5);

const previousTz = process.env.TZ;
for (const timezone of ['Asia/Jerusalem', 'America/Los_Angeles', 'UTC']) {
  process.env.TZ = timezone;
  assert.deepEqual(shiftedMonthRange('2026-05-31', -1), { from: '2026-04-01', to: '2026-04-30' });
  assert.deepEqual(shiftedMonthRange('2026-01-01', -1), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(shiftedMonthRange('2024-03-31', -1), { from: '2024-02-01', to: '2024-02-29' });
  assert.equal(addDays(isoDate(new Date(2026, 8, 12, 0, 5)), -6), '2026-09-06');
}
if (previousTz === undefined) delete process.env.TZ;
else process.env.TZ = previousTz;

const entries = [
  makeEntry('2026-09-01', { contractors: [
    { id: 'a', trade: 'A', workers: '3 workers' }, { id: 'b', trade: 'A', workers: '2' },
    { id: 'c', trade: 'a', workers: '90' }, { id: 'd', trade: '=A*?', workers: '6' },
  ], equipment: [{ id: 'machine', kind: 'PRIVATE-EQUIPMENT', qty: '2', hours: '8' }] }),
  makeEntry('2026-09-02', { contractors: [{ id: 'a', trade: 'A', workers: '4' }] }),
  makeEntry('2026-09-03', { deletedAt: 2, contractors: [{ id: 'a', trade: 'A', workers: '100' }] }),
];
const groups = summaryGroups(entries, STRINGS.en, { kind: 'trades', label: 'A' });
assert.equal(groups.length, 1);
assert.deepEqual(groups[0].totals, [{ label: 'A', value: 9, days: 2 }]);
assert.equal(groups[0].sources.length, 3);
assert.equal(groups[0].sources[0].fields[0][1], '3 workers');
assert(!JSON.stringify(groups).includes('PRIVATE-'));
assert.deepEqual(summaryGroups(entries, STRINGS.en, { kind: 'trades', label: 'missing' }), []);

const workbook = await buildSummaryWorkbook(entries, project, '2026-09-01', '2026-09-30', STRINGS.en, { kind: 'trades', label: 'A' });
const zip = await JSZip.loadAsync(await workbook.arrayBuffer());
const summaryXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
const detailXml = await zip.file('xl/worksheets/sheet2.xml')!.async('string');
assert(summaryXml.includes('SUMPRODUCT(--EXACT('));
assert(summaryXml.includes('<v>9</v>'));
assert(detailXml.includes('3 workers'));
assert(!detailXml.includes('PRIVATE-'));
assert(!detailXml.includes('<v>90</v>'));
assert(!detailXml.includes('<v>100</v>'));
const rangeZip = await JSZip.loadAsync(await (await buildRangeWorkbook([
  makeEntry('2026-09-01', { managerSignature: 'signed-on-old-device' }),
], project, STRINGS.en)).arrayBuffer());
assert((await rangeZip.file('xl/worksheets/sheet1.xml')!.async('string')).includes(STRINGS.en.statusSigned));

const bytes = async (name: string): Promise<ArrayBuffer> => {
  const buffer = await readFile(`src/assets/fonts/${name}.ttf`);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};
const fontBytes = {
  hebrew: { regular: await bytes('heebo-regular'), bold: await bytes('heebo-bold') },
  arabic: { regular: await bytes('cairo-regular'), bold: await bytes('cairo-bold') },
};
const selectedPdf = await buildSummaryPdf(entries, project, '2026-09-01', '2026-09-30', {
  fontBytes, strings: STRINGS.en, scope: { kind: 'trades', label: 'A' },
});
await writeFile('tmp/check-summary-filtered.pdf', selectedPdf);
const selectedText = execFileSync('pdftotext', ['tmp/check-summary-filtered.pdf', '-'], { encoding: 'utf8' });
assert(selectedText.includes('Total: 9 workers'));
assert(selectedText.includes('3 workers'));
assert(!selectedText.includes('PRIVATE-'));

// Exactly 33 rows previously exhausted the cover with no room for its total.
const boundary = await buildRangePdf([makeEntry('2026-09-01', { contractors:
  Array.from({ length: 33 }, (_, i) => ({ id: String(i), trade: `Trade ${i}`, workers: '1' })),
})], project, '2026-09-01', '2026-09-01', { fontBytes, strings: STRINGS.en });
await writeFile('tmp/check-summary-boundary.pdf', boundary);
const boundaryText = execFileSync('pdftotext', ['tmp/check-summary-boundary.pdf', '-'], { encoding: 'utf8' });
assert(boundaryText.includes('Total'));
assert.equal((await PDFDocument.load(boundary)).getPageCount(), 3);

const longPdf = await buildSummaryPdf([makeEntry('2026-09-01', { casting: {
  ...emptyCasting(), concreteType: 'B30', concreteQty: '12',
  notes: 'Long note with meaningful detail. '.repeat(450) + '\nFINAL-SOURCE-MARKER',
} })], project, '2026-09-01', '2026-09-01', { fontBytes, strings: STRINGS.en, scope: { kind: 'concrete' } });
await writeFile('tmp/check-summary-long.pdf', longPdf);
assert((await PDFDocument.load(longPdf)).getPageCount() > 1);
assert(execFileSync('pdftotext', ['tmp/check-summary-long.pdf', '-'], { encoding: 'utf8' }).includes('FINAL-SOURCE-MARKER'));

// Theme state must not change while the first build waits for a legacy photo.
class SlowBlob extends Blob {
  async arrayBuffer() {
    await new Promise(resolve => setTimeout(resolve, 20));
    return super.arrayBuffer();
  }
}
const photo = { id: 'slow-photo', caption: '', width: 1, height: 1, takenAt: 1,
  blob: new SlowBlob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=', 'base64')]) };
const [first, second] = await Promise.all([
  buildEntryDoc(makeEntry('2026-09-01', { photos: [photo] }), project, { strings: STRINGS.he, fontFamily: 'Cousine' }),
  buildEntryDoc(makeEntry('2026-09-02'), project, { strings: STRINGS.en, fontFamily: 'Arial', includePhotos: false }),
]);
const firstZip = await JSZip.loadAsync(await Packer.toBuffer(first));
const secondZip = await JSZip.loadAsync(await Packer.toBuffer(second));
assert((await firstZip.file('word/document.xml')!.async('string')).includes('Cousine'));
assert(!(await secondZip.file('word/document.xml')!.async('string')).includes('Cousine'));
console.log('Report regressions passed: date zones, scoped sources/totals, spreadsheet formulas/status, PDF boundary/long text, concurrent Word themes.');
