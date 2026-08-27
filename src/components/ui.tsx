/** Small presentational primitives shared by every screen. */
import type { ReactNode } from 'react';
import { useLanguage } from '../i18n/useLanguage';
import { useEscape } from '../hooks/useEscape';
import { Icon, type IconName } from './Icon';

/**
 * A section of a screen.
 *
 * `collapsible` turns the heading into the control that opens it, and is what
 * the diary page is built out of: ten sections, all of them open at once, made
 * a form four screens long on a phone — the button you press most often was a
 * screenful of scrolling away from the field you were typing in. Folded, a
 * section that has been filled in shows what is in it on one line, so the page
 * gets *shorter* as the day gets written rather than longer.
 *
 * `summary` is that line, `done` swaps the step number for a tick, and the
 * body is not rendered at all while it is closed — a folded section costs
 * nothing to have on the page.
 */
export function Card({
  title,
  step,
  action,
  note,
  collapsible = false,
  open = true,
  onToggle,
  summary,
  done = false,
  id,
  children,
}: {
  title?: string;
  step?: number;
  action?: ReactNode;
  note?: string;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  summary?: string;
  done?: boolean;
  id?: string;
  children: ReactNode;
}) {
  const badge = (
    <span className={`section-badge${done ? ' section-badge--done' : ''}`}>
      {done ? <Icon name="check" size={15} strokeWidth={2.6} /> : step}
    </span>
  );

  return (
    <section className={`card${collapsible && !open ? ' card--folded' : ''}`} id={id}>
      {collapsible && title ? (
        <button type="button" className="card__toggle" aria-expanded={open} onClick={onToggle}>
          {step !== undefined && badge}
          <span className="card__toggle-text">
            <span className="card__toggle-title">{title}</span>
            {!open && summary && <span className="card__toggle-summary">{summary}</span>}
          </span>
          <Icon name="chevronDown" size={18} className="card__caret" />
        </button>
      ) : (
        title && (
          <header className="card__head">
            {step !== undefined && badge}
            <h2>{title}</h2>
            {action}
          </header>
        )
      )}
      {(!collapsible || open) && (
        <div className="card__body">
          {note && <p className="card__note" style={{ marginBottom: 12 }}>{note}</p>}
          {children}
        </div>
      )}
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
  icon: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={icon} size={34} strokeWidth={1.5} />
      </div>
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
  // A dialog closes on Escape everywhere else on the machine; it should here.
  useEscape(onClose);

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

/**
 * `subtle` is for the diary list, and the difference is about what a row is for.
 *
 * On the editor and on a tile the status is a statement about the page you are
 * looking at, and a filled pill is right. In a list of thirty rows it is one
 * fact among four, and thirty coloured pills stop being information — they
 * become the pattern your eye follows instead of the descriptions, which are
 * the reason anyone opened the diary. Same words, a dot instead of a fill.
 */
export function StatusChip({
  status,
  subtle = false,
}: {
  status: 'draft' | 'signed';
  subtle?: boolean;
}) {
  const { t } = useLanguage();
  const signed = status === 'signed';
  const label = signed ? t.statusSigned : t.statusDraft;

  if (subtle) {
    return (
      <span className={`status status--${signed ? 'ok' : 'draft'}`}>
        <span className="status__dot" aria-hidden="true" />
        {label}
      </span>
    );
  }

  return signed ? (
    <span className="chip chip--ok">
      <Icon name="check" size={13} strokeWidth={2.8} />
      {label}
    </span>
  ) : (
    <span className="chip chip--draft">{label}</span>
  );
}
