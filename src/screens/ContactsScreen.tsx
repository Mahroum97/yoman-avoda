/**
 * ספקים וקבלנים — the site's own address book.
 *
 * A table you type straight into, rather than a form behind an "add" button:
 * the whole value of the list is that adding a number takes a moment while the
 * man is still standing there. Every keystroke is saved on its own, so there is
 * no save button to forget and nothing to lose by walking away.
 *
 * One DOM serves both shapes. On a wide window it is a real table with a header
 * row; on a phone each line folds into a card whose fields carry their own
 * labels — a six-column table at 390px is not a table, it is a scroll bar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Contact } from '../types';
import {
  blankContact,
  deleteContact,
  restoreContact,
  saveContact,
} from '../db';
import { useContacts } from '../hooks/useData';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { EmptyState } from '../components/ui';

/** Long enough that typing a word is one write, short enough to feel saved. */
const SAVE_AFTER_MS = 500;

/** The five typed columns, in the order the user asked for them. */
type Column = 'name' | 'trade' | 'phone' | 'projects' | 'notes';

export function ContactsScreen() {
  const stored = useContacts();
  const toast = useToast();
  const { t } = useLanguage();
  const [query, setQuery] = useState('');

  /*
   * Edits that have not reached the database yet.
   *
   * The ref is the copy the timers read — a `setTimeout` closes over the state
   * it was created with, and the whole point here is to write the *latest* text
   * rather than the text as it stood when the user first touched the cell. The
   * state copy exists only to re-render.
   */
  const [pending, setPending] = useState<Map<string, Contact>>(new Map());
  const pendingRef = useRef(pending);
  const timers = useRef(new Map<string, number>());

  const putPending = (next: Map<string, Contact>) => {
    pendingRef.current = next;
    setPending(next);
  };

  const flush = useCallback(async (uid: string) => {
    const timer = timers.current.get(uid);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(uid);
    }
    const row = pendingRef.current.get(uid);
    if (!row) return;
    // Dropped from the pending map only after the write, and only if no newer
    // keystroke replaced it meanwhile — otherwise the last letter typed would
    // be rolled back by the live query returning the row as it was saved.
    await saveContact(row);
    if (pendingRef.current.get(uid) === row) {
      const next = new Map(pendingRef.current);
      next.delete(uid);
      putPending(next);
    }
  }, []);

  const flushAll = useCallback(() => {
    for (const uid of [...pendingRef.current.keys()]) void flush(uid);
  }, [flush]);

  /*
   * Nothing typed may be left behind by leaving the screen — or, on iOS, by the
   * app being backgrounded, which can end the page without another event. Both
   * are the same rule the activity log follows for the same platform reason.
   */
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushAll();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      flushAll();
    };
  }, [flushAll]);

  const edit = (row: Contact, key: Column, value: string) => {
    const next = new Map(pendingRef.current);
    next.set(row.uid, { ...row, [key]: value });
    putPending(next);

    const existing = timers.current.get(row.uid);
    if (existing !== undefined) clearTimeout(existing);
    timers.current.set(
      row.uid,
      window.setTimeout(() => void flush(row.uid), SAVE_AFTER_MS),
    );
  };

  const add = async () => {
    const row = blankContact();
    await saveContact(row);
    // The row exists before the first letter is typed, so an interrupted entry
    // survives the app being closed. Focus follows it once it has rendered.
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-first='${row.uid}']`);
      input?.focus();
    });
  };

  const remove = async (row: Contact) => {
    if (row.id === undefined) return;
    await deleteContact(row.id);
    // An undo rather than a confirmation, as in the diary list: the question
    // costs everyone time, and the answer to a mistake is putting it back.
    toast.show(t.contactDeleted, {
      label: t.undo,
      run: () => void restoreContact(row),
    });
  };

  /** The pending copy of a row wins, so typing is never rolled back mid-word. */
  const rows = useMemo(
    () => (stored ?? []).map((row) => pending.get(row.uid) ?? row),
    [stored, pending],
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.name, row.trade, row.phone, row.projects, row.notes]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [rows, query]);

  if (!stored) return <p className="muted">{t.loading}</p>;

  const columns: { key: Column; label: string; placeholder: string }[] = [
    { key: 'name', label: t.labelContactName, placeholder: t.phContactName },
    { key: 'trade', label: t.labelContactTrade, placeholder: t.phContactTrade },
    { key: 'phone', label: t.labelContactPhone, placeholder: t.phContactPhone },
    { key: 'projects', label: t.labelContactProjects, placeholder: t.phContactProjects },
    { key: 'notes', label: t.labelContactNotes, placeholder: t.phContactNotes },
  ];

  return (
    <div className="contacts">
      <div className="contacts__head">
        <div className="contacts__heading">
          <h1>{t.contactsTitle}</h1>
          {rows.length > 0 && <span className="chip">{t.contactsCount(rows.length)}</span>}
        </div>
        <p className="muted small contacts__blurb">{t.contactsBlurb}</p>
        <div className="contacts__tools">
          <input
            type="search"
            className="contacts__search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchContacts}
            aria-label={t.searchContacts}
          />
          <button type="button" className="btn btn--primary" onClick={() => void add()}>
            ＋ {t.newContact}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="📇" title={t.noContactsTitle}>
          <p className="muted" style={{ marginBottom: 16 }}>
            {t.noContactsBody}
          </p>
          <button type="button" className="btn btn--primary" onClick={() => void add()}>
            ＋ {t.newContact}
          </button>
        </EmptyState>
      ) : shown.length === 0 ? (
        <p className="muted">{t.noMatches}</p>
      ) : (
        <div className="ctable">
          {/* Column titles on a wide window only; on a phone each cell carries
              its own label, so repeating them here would read twice. */}
          <div className="ctable__head" aria-hidden="true">
            <span className="ctable__no">{t.contactNo}</span>
            {columns.map((column) => (
              <span key={column.key}>{column.label}</span>
            ))}
            <span />
          </div>

          {shown.map((row) => (
            <Row
              key={row.uid}
              row={row}
              /* Numbered by position in the whole list, not in the filtered
                 view, so a line keeps the number it had before the search. */
              index={rows.indexOf(row) + 1}
              columns={columns}
              onEdit={edit}
              onBlur={() => void flush(row.uid)}
              onDelete={() => void remove(row)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  row,
  index,
  columns,
  onEdit,
  onBlur,
  onDelete,
}: {
  row: Contact;
  index: number;
  columns: { key: Column; label: string; placeholder: string }[];
  onEdit: (row: Contact, key: Column, value: string) => void;
  onBlur: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const dialable = row.phone.replace(/[^\d+]/g, '');

  return (
    <div className="ctable__row">
      <div className="ctable__no">
        <span className="ctable__badge">{index}</span>
      </div>

      {columns.map((column) => (
        <div
          className={`ctable__cell ctable__cell--${column.key}`}
          data-label={column.label}
          key={column.key}
        >
          <input
            type={column.key === 'phone' ? 'tel' : 'text'}
            /* A phone number is Latin digits inside a Hebrew or Arabic page:
               without its own direction it renders with the sign and any dash
               in the wrong place. */
            dir={column.key === 'phone' ? 'ltr' : undefined}
            inputMode={column.key === 'phone' ? 'tel' : undefined}
            className={column.key === 'phone' ? 'ctable__input ctable__input--tel' : 'ctable__input'}
            data-first={column.key === 'name' ? row.uid : undefined}
            value={row[column.key]}
            placeholder={column.placeholder}
            aria-label={column.label}
            onChange={(e) => onEdit(row, column.key, e.target.value)}
            onBlur={onBlur}
          />
        </div>
      ))}

      <div className="ctable__tools">
        {dialable && (
          // The reason the list exists on a phone at all.
          <a
            className="icon-btn"
            href={`tel:${dialable}`}
            aria-label={t.callContact(row.name || t.unnamedContact)}
            title={t.callContact(row.name || t.unnamedContact)}
          >
            <span aria-hidden="true">📞</span>
          </a>
        )}
        <button
          type="button"
          className="icon-btn icon-btn--danger"
          onClick={onDelete}
          aria-label={t.deleteContact}
          title={t.deleteContact}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
    </div>
  );
}
