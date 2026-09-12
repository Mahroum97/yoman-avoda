/** Daily crews have an explicit contractor identity, independent of their trade. */
import { useEffect, useRef, useState } from 'react';
import { blankContact, saveContact } from '../db';
import { useContacts } from '../hooks/useData';
import { useLanguage } from '../i18n/useLanguage';
import { parseExactQuantity, parseWorkerCount } from '../lib/exactQuantity';
import { uid } from '../lib/id';
import type { Contact, ContractorRow } from '../types';
import { Icon } from './Icon';
import { Combobox, Field } from './ui';

const NEW_CONTACT = '__new_contact__';

function ContractorLine({
  row, index, count, contacts, tradeOptions, onChange, onMove, onRemove,
}: {
  row: ContractorRow;
  index: number;
  count: number;
  contacts: Contact[];
  tradeOptions: string[];
  onChange: (changes: Partial<ContractorRow>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const { t } = useLanguage();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const mounted = useRef(false);
  const update = useRef(onChange);
  update.current = onChange;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const parsed = parseWorkerCount(row.workers ?? '');
  const integer = parsed.value !== null;
  const isFraction = parseExactQuantity(row.workers ?? '').value?.includes('.') ?? false;
  const hasDetails = !!(row.trade?.trim() || row.contractorName?.trim() || row.workers?.trim());
  const quantityIssue = hasDetails && (parsed.issue !== null || !integer);
  const identityIssue = hasDetails && !row.contractorUid;
  const issueId = `contractor-quantity-${row.id}`;
  const contactMissing = row.contractorUid && !contacts.some(contact => contact.uid === row.contractorUid);

  const selectContact = (value: string) => {
    setSaveFailed(false);
    if (value === NEW_CONTACT) {
      setCreating(true);
      setName(row.contractorName ?? '');
      return;
    }
    setCreating(false);
    const contact = contacts.find(item => item.uid === value);
    if (contact) onChange({ contractorUid: contact.uid, contractorName: contact.name });
    else if (!value) onChange({ contractorUid: undefined, contractorName: '' });
  };

  const createContractor = async () => {
    if (saving || !name.trim()) return;
    setSaving(true);
    setSaveFailed(false);
    const contact = { ...blankContact(), name: name.trim(), trade: row.trade ?? '' };
    try {
      await saveContact(contact);
      // A new contact remains saved if navigation occurred while it was being
      // written; it must never be attached to a different day after unmount.
      if (!mounted.current) return;
      update.current({ contractorUid: contact.uid, contractorName: contact.name });
      setCreating(false);
      setName('');
    } catch {
      if (mounted.current) setSaveFailed(true);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const stepWorkers = (delta: number) => {
    if (!row.workers?.trim()) {
      if (delta > 0) onChange({ workers: '1' });
      return;
    }
    // A range or arithmetic expression is left intact for the user to resolve.
    if (!integer || parsed.value === null) return;
    const next = BigInt(parsed.value) + BigInt(delta);
    const suffix = row.workers.match(/(\s+(?:עובדים|עובד|workers?|عمال|عمّال|عامل|عاملين))\s*$/iu)?.[1] ?? '';
    onChange({ workers: `${next < 0n ? 0n : next}${suffix}` });
  };

  return (
    <div className="row-item row-item--2">
      <div className="row-item__index">
        <span>{t.rowNumber(index + 1)}</span>
        <div className="row-item__actions">
          <button type="button" className="rowbtn" aria-label={t.moveUp} disabled={index === 0} onClick={() => onMove(-1)}>
            <Icon name="arrowUp" size={17} />
          </button>
          <button type="button" className="rowbtn" aria-label={t.moveDown} disabled={index === count - 1} onClick={() => onMove(1)}>
            <Icon name="arrowDown" size={17} />
          </button>
          <button type="button" className="rowbtn rowbtn--danger" aria-label={t.deleteRow} onClick={onRemove}>
            <Icon name="close" size={17} />
          </button>
        </div>
      </div>
      <div className="row-item__grid">
        <Field label={t.reportContractorName}>
          <select aria-label={t.reportContractorName} aria-describedby={identityIssue ? `contractor-identity-${row.id}` : undefined} value={creating ? NEW_CONTACT : row.contractorUid ?? ''} disabled={saving} onChange={event => selectContact(event.target.value)}>
            <option value="">{row.contractorName || t.reportChooseContact}</option>
            {contactMissing && <option value={row.contractorUid}>{row.contractorName || t.reportUnassignedContractor}</option>}
            {contacts.map(contact => (
              <option key={contact.uid} value={contact.uid}>
                {contact.uid === row.contractorUid ? row.contractorName || contact.name : contact.name}
                {contact.trade ? ` · ${contact.trade}` : ''}
                {contact.phone ? ` · ${contact.phone}` : ''}
              </option>
            ))}
            <option value={NEW_CONTACT}>{t.materialNewContractor}</option>
          </select>
          {identityIssue && <span id={`contractor-identity-${row.id}`} className="field__hint quantity-input-issue">{t.reportUnassignedContractor}</span>}
        </Field>
        <Field label={t.labelTrade}>
          <Combobox value={row.trade ?? ''} onChange={trade => onChange({ trade })} options={tradeOptions} listId={`contractor-trades-${row.id}`} placeholder={t.phTrade} />
        </Field>
        <Field label={t.labelWorkers}>
          <div className="stepper stepper--neutral">
            <button type="button" className="stepper__btn" aria-label={t.decrease} disabled={!integer || Number(parsed.value) === 0} onClick={() => stepWorkers(-1)}>
              <Icon name="minus" size={18} strokeWidth={2.2} />
            </button>
            <input className="stepper__value" type="text" inputMode="numeric" value={row.workers ?? ''} placeholder="0" aria-label={t.labelWorkers} aria-invalid={quantityIssue || undefined} aria-describedby={quantityIssue ? issueId : undefined} onChange={event => onChange({ workers: event.target.value })} />
            <button type="button" className="stepper__btn" aria-label={t.increase} disabled={!!row.workers?.trim() && !integer} onClick={() => stepWorkers(1)}>
              <Icon name="plus" size={18} strokeWidth={2.2} />
            </button>
          </div>
          {quantityIssue && <span id={issueId} className="field__hint quantity-input-issue">{isFraction ? t.reportWorkersInteger : t.reportInvalidQuantity}</span>}
        </Field>
      </div>
      {creating && (
        <div className="stack">
          <Field label={t.materialNewContractor}>
            <input type="text" value={name} disabled={saving} onChange={event => setName(event.target.value)} />
          </Field>
          <div className="btn-row">
            <button type="button" className="btn" disabled={saving || !name.trim()} onClick={() => void createContractor()}>{saving ? t.savingNote : t.materialSaveContractor}</button>
            <button type="button" className="btn btn--ghost" disabled={saving} onClick={() => { setCreating(false); setSaveFailed(false); }}>{t.cancel}</button>
          </div>
          {saveFailed && <p role="alert" className="quantity-input-issue">{t.actionFailed}</p>}
        </div>
      )}
    </div>
  );
}

export function ContractorRowsEditor({ rows, onChange, tradeOptions }: {
  rows: ContractorRow[];
  onChange: (rows: ContractorRow[]) => void;
  tradeOptions: string[];
}) {
  const { t } = useLanguage();
  const contacts = (useContacts() ?? []).filter(contact => contact.name.trim());

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="stack contractor-editor">
      <div className="rows">
        {rows.map((row, index) => (
          <ContractorLine key={row.id} row={row} index={index} count={rows.length} contacts={contacts} tradeOptions={tradeOptions}
            onChange={changes => onChange(rows.map(current => current.id === row.id ? { ...current, ...changes } : current))}
            onMove={delta => move(index, delta)} onRemove={() => onChange(rows.filter(current => current.id !== row.id))} />
        ))}
      </div>
      <div>
        <button type="button" className="btn" onClick={() => onChange([...rows, { id: uid(), trade: '', workers: '' }])}>
          <Icon name="plus" size={16} />{t.addContractor}
        </button>
      </div>
    </div>
  );
}
