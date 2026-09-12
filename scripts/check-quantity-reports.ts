/** Synthetic quantity-report regressions. No real diary database is opened. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import type { DiaryEntry, MaterialDelivery, Project } from '../src/types';
import { emptyCasting } from '../src/types';
import { STRINGS } from '../src/i18n/strings';
import { quantityReports } from '../src/lib/quantityReport';
import { buildQuantityReportWorkbook } from '../src/xlsx/quantityReport';
import { buildQuantityReportPdf } from '../src/pdf/build';

const t = STRINGS.en;
const project: Project = {
  id: 1,
  uid: 'project-1',
  name: 'Quantity QA',
  address: 'Test site',
  company: 'QA',
  archived: false,
  createdAt: 1,
  updatedAt: 1,
};

const delivery = (
  id: string,
  changes: Partial<MaterialDelivery>,
): MaterialDelivery => ({
  id,
  material: 'concrete',
  quantity: '1',
  unit: 'm3',
  supplierUid: 'supplier-1',
  supplierName: 'Ready Mix',
  deliveryNote: id,
  specification: 'B30',
  location: 'Building A',
  notes: '',
  ...changes,
});

const entry = (
  uid: string,
  date: string,
  changes: Partial<DiaryEntry> = {},
): DiaryEntry => ({
  id: Number(uid.replace(/\D/g, '')) || 1,
  uid,
  projectUid: project.uid,
  projectId: project.id!,
  date,
  weather: '',
  management: [],
  contractors: [],
  equipment: [],
  workDescription: '',
  casting: emptyCasting(),
  supervisorNotes: '',
  receivedToday: '',
  supervisorSignature: '',
  managerSignature: '',
  photos: [],
  status: 'draft',
  createdAt: 1,
  updatedAt: 1,
  ...changes,
});

const rows: DiaryEntry[] = [
  entry('entry-1', '2026-09-01', {
    casting: { ...emptyCasting(), concreteType: 'MUST-NOT-COUNT', concreteQty: '999999' },
    contractors: [
      { id: 'a1', trade: 'Formwork', workers: '3 workers', contractorUid: 'contractor-a', contractorName: 'Same name' },
      { id: 'a2', trade: 'Formwork', workers: '2 עובדים', contractorUid: 'contractor-a', contractorName: 'Same name' },
      { id: 'b1', trade: 'Steel', workers: '2', contractorUid: 'contractor-b', contractorName: 'Same name' },
      { id: 'u1', trade: 'Finishing', workers: '9', contractorName: 'Same name' },
    ],
    deliveryLedger: {
      version: 1,
      reviewed: true,
      rows: [
        delivery('c-01', { quantity: '0.1' }),
        delivery('c-02', { quantity: '0.2' }),
        delivery('c-ambiguous', { quantity: '12,345' }),
        delivery('c-no-supplier', { quantity: '5', supplierUid: undefined, supplierName: '' }),
        delivery('c-no-ticket', { quantity: '6', deliveryNote: '' }),
        // A manual snapshot can duplicate a linked supplier and must flag both.
        delivery('c-cross-linked', { quantity: '2', supplierUid: 'cross-id', supplierName: 'Cross Supplier', deliveryNote: 'CROSS' }),
        delivery('c-cross-manual', { quantity: '3', supplierUid: undefined, supplierName: 'Cross Supplier', deliveryNote: 'CROSS' }),
        // Two known, distinct identities sharing a display name stay separate.
        delivery('c-distinct-1', { quantity: '4', supplierUid: 'distinct-1', supplierName: 'Shared Supplier', deliveryNote: 'SHARED' }),
        delivery('c-distinct-2', { quantity: '5', supplierUid: 'distinct-2', supplierName: 'Shared Supplier', deliveryNote: 'SHARED' }),
        delivery('s-tonne', { material: 'steel', unit: 'tonne', quantity: '1.25', deliveryNote: 'ST-1', specification: 'D12' }),
        delivery('s-kg', { material: 'steel', unit: 'kg', quantity: '50', deliveryNote: 'ST-2', specification: 'D12' }),
        delivery('s-dup-1', { material: 'steel', unit: 'kg', quantity: '10', deliveryNote: 'DUP', specification: 'D16' }),
        delivery('s-dup-2', { material: 'steel', unit: 'kg', quantity: '11', deliveryNote: 'DUP', specification: 'D16' }),
        // Same ticket but a different specification is a distinct legitimate line.
        delivery('s-different-spec', { material: 'steel', unit: 'kg', quantity: '7', deliveryNote: 'DUP', specification: 'D20' }),
      ],
    },
  }),
  entry('entry-2', '2026-09-02', {
    receivedToday: 'PRIVATE HISTORICAL TEXT — 800 tonnes and another supplier',
    contractors: [
      { id: 'a3', trade: 'Formwork', workers: '٤ عمال', contractorUid: 'contractor-a', contractorName: 'Same name' },
      { id: 'a4', trade: 'Formwork', workers: '3-5', contractorUid: 'contractor-a', contractorName: 'Same name' },
      { id: 'b2', trade: 'Steel', workers: '1', contractorUid: 'contractor-b', contractorName: 'Same name' },
    ],
    deliveryLedger: {
      version: 1,
      reviewed: false,
      rows: [
        delivery('c-unreviewed', { quantity: '1', supplierUid: undefined, supplierName: 'Manual Supplier' }),
        delivery('s-wrong-unit', { material: 'steel', unit: 'm3', quantity: '400' }),
      ],
    },
  }),
  entry('entry-3', '2026-09-03', {
    receivedToday: 'PRIVATE LEGACY DELIVERY CONTENT',
  }),
  entry('entry-outside', '2026-10-01', {
    deliveryLedger: { version: 1, reviewed: true, rows: [delivery('outside', { quantity: '500' })] },
  }),
  entry('entry-other-project', '2026-09-04', {
    projectUid: 'project-2',
    deliveryLedger: { version: 1, reviewed: true, rows: [delivery('other', { quantity: '600' })] },
  }),
  entry('entry-deleted', '2026-09-05', {
    deletedAt: 2,
    deliveryLedger: { version: 1, reviewed: true, rows: [delivery('deleted', { quantity: '700' })] },
  }),
];

const reports = quantityReports(rows, project.uid, '2026-09-01', '2026-09-30', t);
const concrete = reports.find((report) => report.id === 'concrete')!;
const steel = reports.find((report) => report.id === 'steel')!;
const contractorA = reports.find((report) => report.id === 'contractor:contractor-a')!;
const contractorB = reports.find((report) => report.id === 'contractor:contractor-b')!;
const unassigned = reports.find((report) => report.id === 'contractor:unassigned')!;

assert.equal(concrete.totals.known, '10.3');
assert.equal(concrete.totals.sourceRows, 10);
assert.equal(concrete.totals.countedRows, 5);
assert.deepEqual(concrete.dailyTotals.map((day) => [day.date, day.value]), [
  ['2026-09-01', '9.3'],
  ['2026-09-02', '1'],
]);
assert.equal(concrete.rows.filter((row) => row.issueCodes.includes('duplicate-ticket')).length, 2);
assert(concrete.rows.find((row) => row.sourceId === 'c-distinct-1')?.included);
assert(concrete.rows.find((row) => row.sourceId === 'c-distinct-2')?.included);
assert(concrete.issues.some((issue) => issue.code === 'ledger-unreviewed' && issue.date === '2026-09-03'));
assert(concrete.issues.some((issue) => issue.code === 'historical-text' && issue.date === '2026-09-02'));
assert(!JSON.stringify(concrete).includes('PRIVATE HISTORICAL'));
assert(!JSON.stringify(concrete).includes('999999'));

assert.equal(steel.totals.known, '1307');
assert.equal(steel.totals.countedRows, 3);
assert.equal(steel.rows.filter((row) => row.issueCodes.includes('duplicate-ticket')).length, 2);
assert(steel.rows.find((row) => row.sourceId === 's-different-spec')?.included);
assert(!steel.rows.find((row) => row.sourceId === 's-wrong-unit')?.included);

assert.equal(contractorA.totals.known, '9');
assert.deepEqual(contractorA.dailyTotals.map((day) => [day.date, day.value]), [
  ['2026-09-01', '5'],
  ['2026-09-02', '4'],
]);
assert.equal(contractorA.totals.countedRows, 3);
assert(contractorA.issues.some((issue) => issue.code === 'quantity-invalid'));
assert.equal(contractorB.totals.known, '3');
assert.equal(unassigned.totals.known, null);
assert.equal(unassigned.totals.countedRows, 0);
assert(unassigned.issues.every((issue) => issue.code === 'contractor-unassigned'));
assert.notEqual(contractorA.id, contractorB.id);
assert.equal(contractorA.title, contractorB.title);

const empty = quantityReports([], project.uid, '2026-09-01', '2026-09-30', t)[0];
assert.equal(empty.totals.known, null);
assert.equal(empty.totals.sourceRows, 0);
const zero = quantityReports([
  entry('entry-zero', '2026-09-01', {
    deliveryLedger: { version: 1, reviewed: true, rows: [delivery('zero', { quantity: '0' })] },
  }),
], project.uid, '2026-09-01', '2026-09-30', t)[0];
assert.equal(zero.totals.known, '0');
assert.equal(zero.totals.countedRows, 1);

await mkdir('tmp', { recursive: true });
const workbook = await buildQuantityReportWorkbook(concrete, project, '2026-09-01', '2026-09-30', t);
const zip = await JSZip.loadAsync(await workbook.arrayBuffer());
const summaryXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
const detailsXml = await zip.file('xl/worksheets/sheet2.xml')!.async('string');
assert(summaryXml.includes("ROUND(SUM(&apos;Daily details&apos;!E2:E11),1)"));
assert(summaryXml.includes('ROUND(SUMIF('));
assert(summaryXml.includes('A$2:A$11'));
assert(summaryXml.includes('<v>10.3</v>'));
assert(summaryXml.includes(t.quantityIssueHistoricalText));
assert(detailsXml.includes('Ready Mix'));
assert(!detailsXml.includes('PRIVATE HISTORICAL'));
assert(!detailsXml.includes('999999'));

const bytes = async (name: string): Promise<ArrayBuffer> => {
  const buffer = await readFile(`src/assets/fonts/${name}.ttf`);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};
const fontBytes = {
  hebrew: { regular: await bytes('heebo-regular'), bold: await bytes('heebo-bold') },
  arabic: { regular: await bytes('cairo-regular'), bold: await bytes('cairo-bold') },
};
const pdf = await buildQuantityReportPdf(concrete, project, '2026-09-01', '2026-09-30', {
  strings: t,
  fontBytes,
});
await writeFile('tmp/check-quantity-report.pdf', pdf);
assert((await PDFDocument.load(pdf)).getPageCount() >= 1);
const pdfText = execFileSync('pdftotext', ['tmp/check-quantity-report.pdf', '-'], { encoding: 'utf8' });
assert(pdfText.includes('10.3'));
assert(pdfText.includes('Ready Mix'));
assert(pdfText.includes(t.quantityIssueHistoricalText));
assert(!pdfText.includes('PRIVATE HISTORICAL'));
assert(!pdfText.includes('999999'));

console.log(
  'Quantity reports passed: strict received totals, duplicate exclusion, kg conversion, stable contractors, issues, PDF and recalculable XLSX.',
);
