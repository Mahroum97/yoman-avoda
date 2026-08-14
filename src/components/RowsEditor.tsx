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
                  <Combobox
                    value={String(row[column.key] ?? '')}
                    onChange={(value) => update(row.id, String(column.key), value)}
                    options={column.options ?? []}
                    listId={`opts-${String(column.key)}`}
                    placeholder={column.placeholder}
                    inputMode={column.inputMode}
                  />
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
