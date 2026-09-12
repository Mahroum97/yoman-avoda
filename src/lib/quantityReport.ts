/**
 * Auditable received-material and named-contractor quantity reports.
 *
 * These totals use only the structured source fields created for them. The
 * printed form's casting quantity is execution data, and `receivedToday` is
 * unstructured historical text; neither is interpreted as a received amount.
 */
import type { DiaryEntry, MaterialDelivery } from '../types';
import type { Strings } from '../i18n/strings';
import {
  addExact,
  parseExactQuantity,
  parseWorkerCount,
  scaleExact,
  type ExactQuantity,
} from './exactQuantity';
import { assertNoReportConflicts } from './reportConflicts';

export type QuantityReportKind = 'concrete' | 'steel' | 'contractor';
export type QuantityIssueCode =
  | 'ledger-unreviewed'
  | 'historical-text'
  | 'quantity-missing'
  | 'quantity-invalid'
  | 'quantity-ambiguous'
  | 'unit-mismatch'
  | 'supplier-missing'
  | 'delivery-note-missing'
  | 'duplicate-ticket'
  | 'contractor-unassigned';

export interface QuantityReportIssue {
  code: QuantityIssueCode;
  date: string;
  entryId?: number;
  entryUid: string;
  rowId?: string;
  /** Relevant source value only; historical free text is deliberately omitted. */
  detail?: string;
}

export interface QuantityReportField {
  label: string;
  value: string;
}

export interface QuantityReportRow {
  /** Unique across diary days even when restored rows reused a local row id. */
  id: string;
  date: string;
  entryId?: number;
  entryUid: string;
  sourceId: string;
  rawQuantity: string;
  sourceUnit: MaterialDelivery['unit'] | 'workers';
  /** Canonical report-unit amount, or null when this source cannot be counted. */
  value: string | null;
  included: boolean;
  issueCodes: QuantityIssueCode[];
  /** Every source field relevant to this selected report. */
  fields: QuantityReportField[];
}

export interface QuantityDailyTotal {
  date: string;
  value: string;
  sourceRowIds: string[];
}

export interface QuantityReportTotals {
  /** Null means no validated source rows; a validated zero is the string "0". */
  known: string | null;
  sourceRows: number;
  countedRows: number;
  days: number;
  issueCount: number;
}

export interface QuantityReport {
  id: string;
  kind: QuantityReportKind;
  title: string;
  /** Unit for the period total: m³, kg, or worker-days. */
  unit: string;
  /** Unit for each dated subtotal: workers for labor, otherwise `unit`. */
  dailyUnit: string;
  contractorUid?: string;
  /** Raw snapshot kept separate from translated PDF text for mixed-script fonts. */
  contractorName?: string;
  rows: QuantityReportRow[];
  dailyTotals: QuantityDailyTotal[];
  totals: QuantityReportTotals;
  issues: QuantityReportIssue[];
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function quantityIssue(parsed: ExactQuantity): QuantityIssueCode | null {
  if (parsed.issue === 'missing') return 'quantity-missing';
  if (parsed.issue === 'ambiguous') return 'quantity-ambiguous';
  if (parsed.issue === 'invalid') return 'quantity-invalid';
  return null;
}

function issueFor(
  code: QuantityIssueCode,
  entry: DiaryEntry,
  rowId?: string,
  detail?: string,
): QuantityReportIssue {
  return {
    code,
    date: entry.date,
    entryId: entry.id,
    entryUid: entry.uid,
    rowId,
    ...(detail ? { detail } : {}),
  };
}

function unitName(unit: MaterialDelivery['unit'], t: Strings): string {
  if (unit === 'm3') return t.materialUnitM3;
  if (unit === 'kg') return t.materialUnitKg;
  return t.materialUnitTonne;
}

function dailyTotals(rows: QuantityReportRow[]): QuantityDailyTotal[] {
  const days = new Map<string, { values: string[]; sourceRowIds: string[] }>();
  for (const row of rows) {
    if (!row.included || row.value === null) continue;
    const day = days.get(row.date) ?? { values: [], sourceRowIds: [] };
    day.values.push(row.value);
    day.sourceRowIds.push(row.id);
    days.set(row.date, day);
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => ({
      date,
      value: addExact(day.values),
      sourceRowIds: day.sourceRowIds,
    }));
}

function finishReport(report: Omit<QuantityReport, 'dailyTotals' | 'totals'>): QuantityReport {
  report.rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const byDay = dailyTotals(report.rows);
  const counted = report.rows.filter((row) => row.included && row.value !== null);
  return {
    ...report,
    dailyTotals: byDay,
    totals: {
      known: counted.length ? addExact(counted.map((row) => row.value!)) : null,
      sourceRows: report.rows.length,
      countedRows: counted.length,
      days: byDay.length,
      issueCount: report.issues.length,
    },
  };
}

interface MaterialCandidate {
  entry: DiaryEntry;
  delivery: MaterialDelivery;
  uidDuplicateKey: string | null;
  nameDuplicateKey: string | null;
  hasSupplierUid: boolean;
  row: QuantityReportRow;
}

function materialReport(
  entries: DiaryEntry[],
  material: 'concrete' | 'steel',
  t: Strings,
): QuantityReport {
  const rows: QuantityReportRow[] = [];
  const issues: QuantityReportIssue[] = [];
  const candidates: MaterialCandidate[] = [];

  for (const entry of entries) {
    const ledger = entry.deliveryLedger;
    if (!ledger?.reviewed) {
      issues.push(issueFor('ledger-unreviewed', entry));
      if (text(entry.receivedToday)) issues.push(issueFor('historical-text', entry));
    }

    for (const delivery of ledger?.rows ?? []) {
      if (delivery.material !== material) continue;
      const id = `${entry.uid}:${delivery.id}`;
      const parsed = parseExactQuantity(delivery.quantity);
      const issueCodes: QuantityIssueCode[] = [];
      const parsedIssue = quantityIssue(parsed);
      if (parsedIssue) issueCodes.push(parsedIssue);

      const rightUnit =
        (material === 'concrete' && delivery.unit === 'm3') ||
        (material === 'steel' && (delivery.unit === 'kg' || delivery.unit === 'tonne'));
      if (!rightUnit) issueCodes.push('unit-mismatch');
      if (!text(delivery.supplierName)) issueCodes.push('supplier-missing');
      if (!text(delivery.deliveryNote)) issueCodes.push('delivery-note-missing');

      const supplierUid = text(delivery.supplierUid);
      const supplierName = text(delivery.supplierName);
      const ticketParts = [
        delivery.material,
        text(delivery.deliveryNote),
        text(delivery.specification),
      ];
      const uidDuplicateKey = supplierUid && ticketParts[1]
        ? JSON.stringify([supplierUid, ...ticketParts])
        : null;
      const nameDuplicateKey = supplierName && ticketParts[1]
        ? JSON.stringify([supplierName, ...ticketParts])
        : null;

      const normalized = parsed.value === null || !rightUnit
        ? null
        : material === 'steel' && delivery.unit === 'tonne'
          ? scaleExact(parsed.value, 3)
          : parsed.value;
      const row: QuantityReportRow = {
        id,
        date: entry.date,
        entryId: entry.id,
        entryUid: entry.uid,
        sourceId: delivery.id,
        rawQuantity: delivery.quantity,
        sourceUnit: delivery.unit,
        value: normalized,
        included: issueCodes.length === 0 && normalized !== null,
        issueCodes,
        fields: [
          { label: t.labelSupplier, value: delivery.supplierName },
          { label: t.labelDeliveryNote, value: delivery.deliveryNote },
          { label: t.labelSpecification, value: delivery.specification },
          { label: t.labelLocation, value: delivery.location },
          { label: t.labelOriginalQuantity, value: delivery.quantity },
          { label: t.materialUnit, value: unitName(delivery.unit, t) },
          { label: t.labelNotes, value: delivery.notes },
        ],
      };
      rows.push(row);
      candidates.push({
        entry,
        delivery,
        uidDuplicateKey,
        nameDuplicateKey,
        hasSupplierUid: Boolean(supplierUid),
        row,
      });
    }
  }

  const uidGroups = new Map<string, MaterialCandidate[]>();
  const nameGroups = new Map<string, MaterialCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.uidDuplicateKey) {
      const group = uidGroups.get(candidate.uidDuplicateKey) ?? [];
      group.push(candidate);
      uidGroups.set(candidate.uidDuplicateKey, group);
    }
    if (candidate.nameDuplicateKey) {
      const group = nameGroups.get(candidate.nameDuplicateKey) ?? [];
      group.push(candidate);
      nameGroups.set(candidate.nameDuplicateKey, group);
    }
  }
  const duplicates = new Set<MaterialCandidate>();
  for (const group of uidGroups.values()) {
    if (group.length > 1) for (const candidate of group) duplicates.add(candidate);
  }
  for (const group of nameGroups.values()) {
    // A manual supplier can be the same supplier as a linked row carrying the
    // exact same snapshot name. Distinct nonempty uids remain distinct when no
    // manual row makes the identity ambiguous.
    if (group.length > 1 && group.some((candidate) => !candidate.hasSupplierUid)) {
      for (const candidate of group) duplicates.add(candidate);
    }
  }
  for (const candidate of duplicates) {
    if (!candidate.row.issueCodes.includes('duplicate-ticket')) {
      candidate.row.issueCodes.push('duplicate-ticket');
      candidate.row.included = false;
    }
  }

  for (const candidate of candidates) {
    for (const code of candidate.row.issueCodes) {
      issues.push(
        issueFor(
          code,
          candidate.entry,
          candidate.row.id,
          code === 'duplicate-ticket' ? candidate.delivery.deliveryNote : undefined,
        ),
      );
    }
  }

  return finishReport({
    id: material,
    kind: material,
    title: material === 'concrete' ? t.quantityConcreteReceived : t.quantitySteelReceived,
    unit: material === 'concrete' ? t.unitCubicMetres : t.unitKilograms,
    dailyUnit: material === 'concrete' ? t.unitCubicMetres : t.unitKilograms,
    rows,
    issues,
  });
}

interface ContractorGroup {
  uid?: string;
  name: string;
  rows: QuantityReportRow[];
  issues: QuantityReportIssue[];
}

function contractorReports(entries: DiaryEntry[], t: Strings): QuantityReport[] {
  const groups = new Map<string, ContractorGroup>();

  for (const entry of entries) {
    for (const source of entry.contractors ?? []) {
      const uid = text(source.contractorUid);
      const key = uid ? `uid:${uid}` : 'unassigned';
      const group = groups.get(key) ?? { uid: uid || undefined, name: '', rows: [], issues: [] };
      if (uid && text(source.contractorName)) group.name = text(source.contractorName);

      const parsed = parseWorkerCount(source.workers);
      const issueCodes: QuantityIssueCode[] = [];
      const parsedIssue = quantityIssue(parsed);
      if (parsedIssue) issueCodes.push(parsedIssue);
      if (!uid) issueCodes.push('contractor-unassigned');
      const id = `${entry.uid}:${source.id}`;
      const row: QuantityReportRow = {
        id,
        date: entry.date,
        entryId: entry.id,
        entryUid: entry.uid,
        sourceId: source.id,
        rawQuantity: source.workers,
        sourceUnit: 'workers',
        value: parsed.value,
        included: uid.length > 0 && parsed.value !== null && issueCodes.length === 0,
        issueCodes,
        fields: [
          { label: t.labelContactName, value: source.contractorName ?? '' },
          { label: t.labelTrade, value: source.trade },
          { label: t.labelWorkers, value: source.workers },
        ],
      };
      group.rows.push(row);
      for (const code of issueCodes) group.issues.push(issueFor(code, entry, id));
      groups.set(key, group);
    }
  }

  return [...groups]
    .map(([key, group]) =>
      finishReport({
        id: key === 'unassigned' ? 'contractor:unassigned' : `contractor:${group.uid}`,
        kind: 'contractor',
        title:
          key === 'unassigned'
            ? t.quantityUnassignedContractors
            : t.quantityContractorLabor(group.name || t.unnamedContact),
        unit: t.unitWorkerDays,
        dailyUnit: t.unitWorkers,
        contractorUid: group.uid,
        contractorName: key === 'unassigned' ? undefined : group.name || t.unnamedContact,
        rows: group.rows,
        issues: group.issues,
      }),
    )
    .sort((a, b) => {
      if (a.id === 'contractor:unassigned') return 1;
      if (b.id === 'contractor:unassigned') return -1;
      return a.title.localeCompare(b.title, t.locale) || a.id.localeCompare(b.id);
    });
}

/**
 * Reports available for one project's inclusive period.
 *
 * Concrete and steel are always returned so a confirmed empty ledger is not
 * confused with a validated zero. Contractor reports exist only for identities
 * actually referenced in the period, plus one review-only unassigned group.
 */
export function quantityReports(
  entries: DiaryEntry[],
  projectUid: string,
  from: string,
  to: string,
  t: Strings,
): QuantityReport[] {
  assertNoReportConflicts(entries);
  const scoped = [...entries]
    .filter(
      (entry) =>
        entry.deletedAt === undefined &&
        entry.projectUid === projectUid &&
        entry.date >= from &&
        entry.date <= to,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));

  return [
    materialReport(scoped, 'concrete', t),
    materialReport(scoped, 'steel', t),
    ...contractorReports(scoped, t),
  ];
}

export function quantityIssueText(code: QuantityIssueCode, t: Strings): string {
  const labels: Record<QuantityIssueCode, string> = {
    'ledger-unreviewed': t.quantityIssueLedgerUnreviewed,
    'historical-text': t.quantityIssueHistoricalText,
    'quantity-missing': t.quantityIssueQuantityMissing,
    'quantity-invalid': t.quantityIssueQuantityInvalid,
    'quantity-ambiguous': t.quantityIssueQuantityAmbiguous,
    'unit-mismatch': t.quantityIssueUnitMismatch,
    'supplier-missing': t.quantityIssueSupplierMissing,
    'delivery-note-missing': t.quantityIssueDeliveryNoteMissing,
    'duplicate-ticket': t.quantityIssueDuplicateTicket,
    'contractor-unassigned': t.quantityIssueContractorUnassigned,
  };
  return labels[code];
}

/** A report with any unresolved issue is explicitly a partial known subtotal. */
export function quantityTotalLabel(report: QuantityReport, t: Strings): string {
  return report.totals.issueCount > 0 ? t.quantityKnownSubtotal : t.quantityPeriodTotal;
}
