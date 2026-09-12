/** A shareable slice of the report, with the source values behind each total. */
import type { DiaryEntry } from '../types';
import type { Strings } from '../i18n/strings';
import { formatNum, parseNum } from '../docx/summary';

export type SummaryKind = 'trades' | 'equipment' | 'concrete';
export interface SummaryScope { kind: SummaryKind; label?: string }
export interface SummarySource {
  date: string;
  label: string;
  value: number;
  /** Original form values, never replaced by their numeric interpretation. */
  fields: [string, string][];
}
export interface SummaryGroup {
  kind: SummaryKind;
  title: string;
  unit: string;
  sources: SummarySource[];
  totals: { label: string; value: number; days: number }[];
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export function summaryGroups(entries: DiaryEntry[], t: Strings, scope?: SummaryScope): SummaryGroup[] {
  const groups: SummaryGroup[] = [
    { kind: 'trades', title: t.summaryTrades, unit: t.unitWorkers, sources: [], totals: [] },
    { kind: 'equipment', title: t.summaryEquipment, unit: t.unitHours, sources: [], totals: [] },
    { kind: 'concrete', title: t.summaryConcrete, unit: t.unitCubicMetres, sources: [], totals: [] },
  ];
  for (const entry of [...entries].filter(e => e.deletedAt === undefined).sort((a, b) => a.date.localeCompare(b.date))) {
    for (const row of entry.contractors ?? []) {
      if (!text(row.trade)) continue;
      groups[0].sources.push({ date: entry.date, label: text(row.trade), value: parseNum(row.workers),
        fields: [[t.labelWorkers, text(row.workers)]] });
    }
    for (const row of entry.equipment ?? []) {
      if (!text(row.kind)) continue;
      groups[1].sources.push({ date: entry.date, label: text(row.kind), value: parseNum(row.hours),
        fields: [[t.labelQty, text(row.qty)], [t.labelHours, text(row.hours)]] });
    }
    const c = entry.casting;
    if (c && (parseNum(c.concreteQty) > 0 || text(c.concreteType))) {
      groups[2].sources.push({ date: entry.date, label: text(c.concreteType) || t.summaryNoType,
        value: parseNum(c.concreteQty), fields: [
          [t.labelConcreteQty, text(c.concreteQty)],
          [t.labelDescription, text(c.description)],
          [t.labelSizeQty, text(c.sizeQty)], [t.labelPump, text(c.pump)],
          [t.labelNotes, text(c.notes)], [t.labelConcreteTypeNote, text(c.notesConcreteType)],
        ] });
    }
  }
  return groups.filter(group => !scope || group.kind === scope.kind).map(group => {
    const sources = group.sources.filter(row => scope?.label === undefined || row.label === scope.label);
    const totals = new Map<string, { value: number; days: Set<string> }>();
    for (const row of sources) {
      const sum = totals.get(row.label) ?? { value: 0, days: new Set<string>() };
      sum.value += row.value;
      sum.days.add(row.date);
      totals.set(row.label, sum);
    }
    return { ...group, sources, totals: [...totals].map(([label, sum]) =>
      ({ label, value: sum.value, days: sum.days.size }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, t.locale)) };
  }).filter(group => group.sources.length > 0);
}

/** Plain source lines also used in the PDF; no other diary sections are included. */
export function sourceDetails(source: SummarySource): string {
  return source.fields.map(([label, value]) => `${label}: ${value || '—'}`).join('\n');
}

export function groupTotal(group: SummaryGroup): number {
  return group.totals.reduce((sum, row) => sum + row.value, 0);
}

export function summaryScopeName(groups: SummaryGroup[], t: Strings, scope?: SummaryScope): string {
  return scope?.label ?? (scope ? groups[0]?.title ?? t.periodSummary : t.periodSummary);
}

export function summaryTotalLabel(group: SummaryGroup, t: Strings): string {
  return `${t.total}: ${formatNum(groupTotal(group))} ${group.unit}`;
}
