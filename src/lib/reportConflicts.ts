import type { DiaryEntry } from '../types';

/**
 * Dates whose live records cannot be represented as one truthful diary day.
 *
 * Conflict markers are useful hints, but the unresolved condition is the data
 * itself: at least two live records linked as preserved alternatives, or two
 * records for the same project and date. A checked editor may have changed its
 * date before preserving both revisions, which is why the stable conflict
 * group is checked before the same-date fallback. A survivor can briefly
 * retain its marker while the other copy moves to Trash, so a marker alone
 * must never keep reports blocked forever.
 */
export interface ReportConflictState {
  dates: string[];
  hasDeletion: boolean;
  hasRevision: boolean;
}

export function reportConflictState(entries: DiaryEntry[]): ReportConflictState {
  const dates = new Map<string, { date: string; count: number }>();
  const linked = new Map<string, DiaryEntry[]>();
  const conflicts = new Set<string>();
  let hasDeletion = false;
  let hasRevision = false;
  for (const entry of entries) {
    if (entry.deletedAt !== undefined) continue;
    const owner = entry.projectUid || String(entry.projectId);
    const dateKey = `${owner}\u0000${entry.date}`;
    const group = dates.get(dateKey);
    if (group) group.count += 1;
    else dates.set(dateKey, { date: entry.date, count: 1 });

    if (entry.syncConflictGroup) {
      const groupKey = `${owner}\u0000${entry.syncConflictGroup}`;
      const alternatives = linked.get(groupKey);
      if (alternatives) alternatives.push(entry);
      else linked.set(groupKey, [entry]);
    }

    // A purge racing an independent edit has only one recoverable live row.
    // It stays blocked until Save explicitly keeps it or Trash confirms the
    // deletion, so waiting for a second live group member would miss it.
    if (
      entry.syncConflict &&
      (entry.syncConflictKind === 'deletion' ||
        (!entry.syncConflictKind && entry.syncConflictGroup?.startsWith('deletion:')))
    ) {
      conflicts.add(entry.date);
      hasDeletion = true;
    }
  }

  for (const group of dates.values()) {
    if (group.count > 1) {
      conflicts.add(group.date);
      hasRevision = true;
    }
  }
  for (const alternatives of linked.values()) {
    if (alternatives.length < 2) continue;
    for (const entry of alternatives) conflicts.add(entry.date);
    if (alternatives.some((entry) => entry.syncConflictKind !== 'deletion')) {
      hasRevision = true;
    }
  }
  return { dates: [...conflicts].sort(), hasDeletion, hasRevision };
}

export function conflictingReportDates(entries: DiaryEntry[]): string[] {
  return reportConflictState(entries).dates;
}

/** A last line of defence for exporters called outside the Reports screen. */
export class ReportConflictError extends Error {
  readonly dates: string[];

  constructor(dates: string[]) {
    super(`Unresolved duplicate diary dates: ${dates.join(', ')}`);
    this.name = 'ReportConflictError';
    this.dates = dates;
  }
}

export function assertNoReportConflicts(entries: DiaryEntry[]): void {
  const dates = conflictingReportDates(entries);
  if (dates.length > 0) throw new ReportConflictError(dates);
}
