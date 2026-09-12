/** Delivery-note quantities received today; independent of the casting form. */
import { useContacts } from '../hooks/useData';
import { useLanguage } from '../i18n/useLanguage';
import { parseExactQuantity } from '../lib/exactQuantity';
import { uid } from '../lib/id';
import type { DeliveryLedger, MaterialDelivery } from '../types';
import { Icon } from './Icon';
import { Field } from './ui';

export function QuantityLedger({ ledger, onChange }: {
  ledger: DeliveryLedger | undefined;
  onChange: (ledger: DeliveryLedger) => void;
}) {
  const { t } = useLanguage();
  const contacts = (useContacts() ?? []).filter(contact => contact.name.trim());
  const rows = ledger?.rows ?? [];

  // Any edit invalidates the previous completeness confirmation. Empty rows
  // and an explicitly reviewed day with no deliveries remain different states.
  const changeRows = (next: MaterialDelivery[]) => onChange({ version: 1, rows: next, reviewed: false });
  const update = (id: string, changes: Partial<MaterialDelivery>) =>
    changeRows(rows.map(row => row.id === id ? { ...row, ...changes } : row));

  const add = (material: MaterialDelivery['material']) => changeRows([...rows, {
    id: uid(), material, quantity: '', unit: material === 'concrete' ? 'm3' : 'kg',
    supplierName: '', deliveryNote: '', specification: '', location: '', notes: '',
  }]);

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    changeRows(next);
  };

  return (
    <div className="stack quantity-ledger">
      <p className="card__note">{t.materialLedgerHint}</p>
      <div className="rows">
        {rows.map((row, index) => {
          const parsed = parseExactQuantity(row.quantity ?? '');
          const hasDetails = !!(row.quantity?.trim() || row.supplierName?.trim() || row.deliveryNote?.trim() || row.specification?.trim() || row.location?.trim() || row.notes?.trim());
          const quantityIssue = hasDetails && parsed.issue !== null;
          const supplierIssue = hasDetails && !row.supplierName?.trim();
          const noteIssue = hasDetails && !row.deliveryNote?.trim();
          const supplierMissing = row.supplierUid && !contacts.some(contact => contact.uid === row.supplierUid);
          const issueId = `delivery-quantity-${row.id}`;
          return (
            <div className="row-item row-item--2" key={row.id}>
              <div className="row-item__index">
                <span>{t.rowNumber(index + 1)} · {row.material === 'concrete' ? t.materialConcrete : t.materialSteel}</span>
                <div className="row-item__actions">
                  <button type="button" className="rowbtn" aria-label={t.moveUp} disabled={index === 0} onClick={() => move(index, -1)}><Icon name="arrowUp" size={17} /></button>
                  <button type="button" className="rowbtn" aria-label={t.moveDown} disabled={index === rows.length - 1} onClick={() => move(index, 1)}><Icon name="arrowDown" size={17} /></button>
                  <button type="button" className="rowbtn rowbtn--danger" aria-label={t.deleteRow} onClick={() => changeRows(rows.filter(current => current.id !== row.id))}><Icon name="close" size={17} /></button>
                </div>
              </div>
              <div className="row-item__grid">
                <Field label={t.materialKind}>
                  <select value={row.material} onChange={event => {
                    const material = event.target.value as MaterialDelivery['material'];
                    update(row.id, { material, unit: material === 'concrete' ? 'm3' : 'kg', quantity: '' });
                  }}>
                    <option value="concrete">{t.materialConcrete}</option>
                    <option value="steel">{t.materialSteel}</option>
                  </select>
                </Field>
                <Field label={t.materialDescription}>
                  <input type="text" value={row.specification ?? ''} onChange={event => update(row.id, { specification: event.target.value })} />
                </Field>
                <Field label={t.labelQty}>
                  <input type="text" inputMode="decimal" value={row.quantity ?? ''} aria-label={t.labelQty} aria-invalid={quantityIssue || undefined} aria-describedby={quantityIssue ? issueId : undefined} onChange={event => update(row.id, { quantity: event.target.value })} />
                  {quantityIssue && <span id={issueId} className="field__hint quantity-input-issue">{t.reportInvalidQuantity}</span>}
                </Field>
                <Field label={t.materialUnit} hint={t.materialUnitHint}>
                  <select aria-label={t.materialUnit} value={row.unit} onChange={event => update(row.id, { unit: event.target.value as MaterialDelivery['unit'], quantity: '' })}>
                    {row.material === 'concrete'
                      ? <option value="m3">{t.materialUnitM3}</option>
                      : <><option value="kg">{t.materialUnitKg}</option><option value="tonne">{t.materialUnitTonne}</option></>}
                  </select>
                </Field>
                <Field label={t.reportChooseContact}>
                  <select value={row.supplierUid ?? ''} onChange={event => {
                    const contact = contacts.find(item => item.uid === event.target.value);
                    if (contact) update(row.id, { supplierUid: contact.uid, supplierName: contact.name });
                    else update(row.id, { supplierUid: undefined });
                  }}>
                    <option value="">{t.reportManualName}</option>
                    {supplierMissing && <option value={row.supplierUid}>{row.supplierName}</option>}
                    {contacts.map(contact => <option key={contact.uid} value={contact.uid}>{contact.uid === row.supplierUid ? row.supplierName || contact.name : contact.name}{contact.trade ? ` · ${contact.trade}` : ''}{contact.phone ? ` · ${contact.phone}` : ''}</option>)}
                  </select>
                </Field>
                <Field label={t.materialSupplier}>
                  <input type="text" value={row.supplierName ?? ''} aria-label={t.materialSupplier} aria-invalid={supplierIssue || undefined} aria-describedby={supplierIssue ? `delivery-supplier-${row.id}` : undefined} onChange={event => update(row.id, { supplierName: event.target.value, supplierUid: undefined })} />
                  {supplierIssue && <span id={`delivery-supplier-${row.id}`} className="field__hint quantity-input-issue">{t.materialSupplierRequired}</span>}
                </Field>
                <Field label={t.materialReference}>
                  <input type="text" value={row.deliveryNote ?? ''} aria-label={t.materialReference} aria-invalid={noteIssue || undefined} aria-describedby={noteIssue ? `delivery-note-${row.id}` : undefined} onChange={event => update(row.id, { deliveryNote: event.target.value })} />
                  {noteIssue && <span id={`delivery-note-${row.id}`} className="field__hint quantity-input-issue">{t.materialNoteRequired}</span>}
                </Field>
                <Field label={t.materialLocation}>
                  <input type="text" value={row.location ?? ''} onChange={event => update(row.id, { location: event.target.value })} />
                </Field>
                <Field label={t.labelNotes}>
                  <textarea
                    rows={2}
                    aria-label={t.labelNotes}
                    value={row.notes ?? ''}
                    onChange={event => update(row.id, { notes: event.target.value })}
                  />
                </Field>
              </div>
            </div>
          );
        })}
      </div>
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => add('concrete')}><Icon name="plus" size={16} />{t.materialAdd} · {t.materialConcrete}</button>
        <button type="button" className="btn" onClick={() => add('steel')}><Icon name="plus" size={16} />{t.materialAdd} · {t.materialSteel}</button>
      </div>
      <label className="quantity-confirmation">
        <input type="checkbox" checked={ledger?.reviewed ?? false} onChange={event => onChange({ version: 1, rows, reviewed: event.target.checked })} />
        <span>{t.materialReviewed}</span>
      </label>
    </div>
  );
}
