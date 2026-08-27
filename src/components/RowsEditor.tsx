/**
 * The repeating-row editor behind the three column groups of
 * "רישום יומי של עובדים וציוד" (management, contractors, equipment).
 */
import { uid } from '../lib/id';
import { Combobox, Field } from './ui';
import { Icon } from './Icon';
import { useLanguage } from '../i18n/useLanguage';

export interface ColumnDef<T> {
  key: Extract<keyof T, string>;
  label: string;
  placeholder?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  /** Remembered values offered as suggestions for this column. */
  options?: string[];
  /**
   * A count, with a minus and a plus either side of it.
   *
   * Typing `3` into a box means summoning the number keyboard, hitting a
   * 40-pixel key and dismissing it again — outdoors, in daylight, often with
   * gloves on. The field stays a field, so anything can still be typed into it;
   * the buttons just move the number that is already there.
   */
  stepper?: boolean;
}

export function RowsEditor<T extends { id: string }>({
  rows,
  columns,
  onChange,
  addLabel,
  emptyValue,
}: {
  rows: T[];
  columns: ColumnDef<T>[];
  onChange: (rows: T[]) => void;
  addLabel: string;
  /** Blank row without its id — the editor assigns one. */
  emptyValue: Omit<T, 'id'>;
}) {
  const { t } = useLanguage();

  const update = (id: string, key: string, value: string) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const remove = (id: string) => onChange(rows.filter((row) => row.id !== id));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const add = () => onChange([...rows, { ...emptyValue, id: uid() } as T]);

  /**
   * Moves the number a cell begins with, and leaves the rest of it alone.
   *
   * The column is free text — `2`, but also `3 עובדים` or `1+2` — so the step
   * works on the leading number and keeps whatever followed it. An empty cell
   * starts at one, which is what a person pressing + on an empty row means.
   */
  const step = (id: string, key: string, by: number) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const text = String((row as Record<string, unknown>)[key] ?? '');
    const match = text.match(/^\s*(\d+)/);
    if (!match) {
      if (by > 0) update(id, key, text.trim() ? `1 ${text.trim()}` : '1');
      return;
    }
    const next = Math.max(0, Number(match[1]) + by);
    update(id, key, text.replace(/^\s*\d+/, String(next)));
  };

  return (
    <div className="stack">
      <div className="rows">
        {rows.map((row, index) => (
          <div className={`row-item row-item--${columns.length}`} key={row.id}>
            <div className="row-item__index">
              <span>{t.rowNumber(index + 1)}</span>
              <div className="row-item__actions">
                <button
                  type="button"
                  className="rowbtn"
                  aria-label={t.moveUp}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <Icon name="arrowUp" size={17} />
                </button>
                <button
                  type="button"
                  className="rowbtn"
                  aria-label={t.moveDown}
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <Icon name="arrowDown" size={17} />
                </button>
                <button
                  type="button"
                  className="rowbtn rowbtn--danger"
                  aria-label={t.deleteRow}
                  onClick={() => remove(row.id)}
                >
                  <Icon name="close" size={17} />
                </button>
              </div>
            </div>
            <div className="row-item__grid">
              {columns.map((column) => (
                <Field label={column.label} key={String(column.key)}>
                  {column.stepper ? (
                    <div className="stepper">
                      <button
                        type="button"
                        className="stepper__btn"
                        aria-label={t.decrease}
                        onClick={() => step(row.id, String(column.key), -1)}
                      >
                        <Icon name="minus" size={18} strokeWidth={2.2} />
                      </button>
                      <input
                        className="stepper__value"
                        type="text"
                        inputMode={column.inputMode ?? 'numeric'}
                        value={String(row[column.key] ?? '')}
                        placeholder={column.placeholder}
                        onChange={(e) => update(row.id, String(column.key), e.target.value)}
                      />
                      <button
                        type="button"
                        className="stepper__btn"
                        aria-label={t.increase}
                        onClick={() => step(row.id, String(column.key), 1)}
                      >
                        <Icon name="plus" size={18} strokeWidth={2.2} />
                      </button>
                    </div>
                  ) : (
                    <Combobox
                      value={String(row[column.key] ?? '')}
                      onChange={(value) => update(row.id, String(column.key), value)}
                      options={column.options ?? []}
                      listId={`opts-${String(column.key)}`}
                      placeholder={column.placeholder}
                      inputMode={column.inputMode}
                    />
                  )}
                </Field>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div>
        <button type="button" className="btn" onClick={add}>
          <Icon name="plus" size={16} />
          {addLabel}
        </button>
      </div>
    </div>
  );
}
