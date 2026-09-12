/** Keep additive reporting data when an older build omits fields it cannot edit. */
import type { ContractorRow, DiaryEntry } from '../types';

export function preserveContractorIdentities(
  incoming: ContractorRow[], existing: ContractorRow[] = [],
): ContractorRow[] {
  const byId = new Map(existing.map(row => [row.id, row]));
  return incoming.map(row => {
    if (Object.hasOwn(row, 'contractorUid') || Object.hasOwn(row, 'contractorName')) return row;
    const previous = byId.get(row.id);
    return previous ? { ...row, contractorUid: previous.contractorUid, contractorName: previous.contractorName } : row;
  });
}

export function preserveReportFields(incoming: DiaryEntry, existing?: DiaryEntry): DiaryEntry {
  return {
    ...incoming,
    contractors: preserveContractorIdentities(incoming.contractors, existing?.contractors),
    ...(incoming.deliveryLedger === undefined && existing?.deliveryLedger !== undefined
      ? { deliveryLedger: existing.deliveryLedger }
      : {}),
  };
}
