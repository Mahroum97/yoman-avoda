/** Small presentational primitives shared by every screen. */
import type { ReactNode } from 'react';
import { useLanguage } from '../i18n/useLanguage';

export function Card({
  title,
  step,
  action,
  note,
  children,
}: {
  title?: string;
  step?: number;
  action?: ReactNode;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {title && (
        <header className="card__head">
          {step !== undefined && <span className="section-badge">{step}</span>}
          <h2>{title}</h2>
          {action}
        </header>
      )}
      <div className="card__body">
        {note && <p className="card__note" style={{ marginBottom: 12 }}>{note}</p>}
        {children}
      </div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

/**
 * Free-text input backed by a `<datalist>` of remembered values — the user can
 * always type something new, and what they type is learned for next time.
 */
export function Combobox({
  value,
  onChange,
  options,
  listId,
  placeholder,
  inputMode,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  listId: string;
  placeholder?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
}) {
  return (
    <>
      <input
        type="text"
        list={options.length ? listId : undefined}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
      />
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <p className="empty__title">{title}</p>
      {children}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal__head">
          <h2>{title}</h2>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

export function StatusChip({ status }: { status: 'draft' | 'signed' }) {
  const { t } = useLanguage();
  return status === 'signed' ? (
    <span className="chip chip--ok">{t.statusSigned}</span>
  ) : (
    <span className="chip chip--draft">{t.statusDraft}</span>
  );
}
