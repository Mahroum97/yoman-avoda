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
  importContacts,
  restoreContact,
  saveContact,
} from '../db';
import { useActiveProject, useContacts, usePresets } from '../hooks/useData';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { saveBlob } from '../lib/save';
import { logger } from '../lib/log';
import { registerPendingWriteFlusher } from '../lib/pendingWrites';
import { EmptyState } from '../components/ui';
import { Icon } from '../components/Icon';

const log = logger('contacts');

/** Long enough that typing a word is one write, short enough to feel saved. */
const SAVE_AFTER_MS = 500;

/** The five typed columns, in the order the user asked for them. */
type Column = 'name' | 'trade' | 'phone' | 'projects' | 'notes';

/** The one column the diary can already answer for itself. */
const TRADE_LIST_ID = 'contact-trades';

export function ContactsScreen() {
  const stored = useContacts();
  /*
   * Every מקצוע ever typed into a diary page's contractor rows, most-used first.
   * The trades on a site are the same handful over and over, and the app already
   * knows them — asking for them again here would be asking twice.
   */
  const presets = usePresets();
  // Only for the company name printed under the title of the exported list.
  const { project } = useActiveProject();
  const toast = useToast();
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  /** The trade being shown on its own, or '' for all of them. */
  const [trade, setTrade] = useState('');

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
  const flushes = useRef(new Map<string, Promise<void>>());
  const [saveFailed, setSaveFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const operation = useRef<string | null>(null);

  const putPending = useCallback((next: Map<string, Contact>) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const begin = (name: string) => {
    if (operation.current !== null) return false;
    operation.current = name;
    setBusy(name);
    return true;
  };

  const finish = () => {
    operation.current = null;
    setBusy(null);
  };

  const flush = useCallback(async (uid: string) => {
    const timer = timers.current.get(uid);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(uid);
    }
    const existing = flushes.current.get(uid);
    if (existing) return existing;

    const run = (async () => {
      while (true) {
        const row = pendingRef.current.get(uid);
        if (!row) return;
        try {
          await saveContact(row);
        } catch (error) {
          // Keep the pending object in the map: it is the visible source of
          // truth and the retry payload. Removing it here would roll the field
          // back to the older live-query value after a failed write.
          setSaveFailed(true);
          log.error('contact autosave failed', error);
          throw error;
        }
        // Dropped only if no newer keystroke replaced it while the write was
        // in flight. If there is a newer version, loop and serialize it behind
        // this one so blur, timer and backup cannot write out of order.
        if (pendingRef.current.get(uid) === row) {
          const next = new Map(pendingRef.current);
          next.delete(uid);
          putPending(next);
          return;
        }
      }
    })();
    flushes.current.set(uid, run);
    try {
      await run;
    } finally {
      if (flushes.current.get(uid) === run) flushes.current.delete(uid);
    }
  }, [putPending]);

  const flushAll = useCallback(async () => {
    const uids = [...pendingRef.current.keys()];
    await Promise.all(uids.map((uid) => flush(uid)));
    setSaveFailed(false);
  }, [flush]);

  /*
   * Nothing typed may be left behind by leaving the screen — or, on iOS, by the
   * app being backgrounded, which can end the page without another event. Both
   * are the same rule the activity log follows for the same platform reason.
   */
  useEffect(() => {
    // Backups and sync take their snapshot only after this promise resolves.
    // Keep the registration alive through unmount flushing: a backup pressed
    // immediately after navigation must still wait for the row being saved by
    // this cleanup.
    // One wrapper per effect setup. React StrictMode sets up, cleans up, then
    // sets up the same effect again; registering `flushAll` itself in an
    // identity Set lets the delayed first cleanup remove the second setup too.
    const registeredFlush = () => flushAll();
    const unregister = registerPendingWriteFlusher(registeredFlush);
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushAll().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      void flushAll().then(unregister, unregister);
    };
  }, [flushAll]);

  const edit = (row: Contact, key: Column, value: string) => {
    const next = new Map(pendingRef.current);
    // Built on the pending copy rather than on `row`, which is as old as the
    // last render: two fields of one line edited between renders would
    // otherwise have the second change carry the first one's stale text back.
    next.set(row.uid, { ...(pendingRef.current.get(row.uid) ?? row), [key]: value });
    putPending(next);

    const existing = timers.current.get(row.uid);
    if (existing !== undefined) clearTimeout(existing);
    timers.current.set(
      row.uid,
      window.setTimeout(() => void flush(row.uid).catch(() => undefined), SAVE_AFTER_MS),
    );
  };

  const add = async () => {
    if (!begin('add')) return;
    const row = blankContact();
    // The row exists before the first letter is typed, so an interrupted entry
    // survives the app being closed.
    try {
      await saveContact(row);
    } catch (error) {
      log.error('contact creation failed', error);
      toast.error(t.contactAddFailed);
      finish();
      return;
    }

    /*
     * Focus follows it, once it is actually there. A single frame is too early:
     * the write has to travel back through the live query before React has
     * anything to render, so this waits for the input to exist rather than
     * assuming it does — and gives up rather than looping if it never appears.
     */
    const deadline = Date.now() + 1500;
    const focus = () => {
      const input = document.querySelector<HTMLInputElement>(`[data-first='${row.uid}']`);
      if (input) {
        input.focus();
        input.scrollIntoView({ block: 'nearest' });
      } else if (Date.now() < deadline) {
        requestAnimationFrame(focus);
      }
    };
    requestAnimationFrame(focus);
    finish();
  };

  /*
   * The three file actions.
   *
   * All of them flush first: an edit still sitting in the debounce is not in the
   * database yet, and a list exported without the line you just typed is worse
   * than one that took half a second longer.
   */
  const printList = async () => {
    if (!begin('print')) return;
    try {
      await flushAll();
    } catch {
      toast.error(t.contactSaveFailed);
      finish();
      return;
    }
    if (rows.length === 0) {
      toast.error(t.contactsNothingToExport);
      finish();
      return;
    }
    try {
      const { exportContactsPdf } = await import('../pdf/export');
      const name = await exportContactsPdf(rows, { owner: project?.company || project?.name });
      if (name) toast.show(t.fileCreated(name));
    } catch (error) {
      log.error('contacts pdf failed', error);
      toast.error(t.pdfFailed);
    } finally {
      finish();
    }
  };

  const exportList = async () => {
    if (!begin('export')) return;
    try {
      await flushAll();
    } catch {
      toast.error(t.contactSaveFailed);
      finish();
      return;
    }
    if (rows.length === 0) {
      toast.error(t.contactsNothingToExport);
      finish();
      return;
    }
    try {
      const { contactsToCsv } = await import('../lib/contactsCsv');
      const csv = contactsToCsv(rows, {
        no: t.contactNo,
        name: t.labelContactName,
        trade: t.labelContactTrade,
        phone: t.labelContactPhone,
        projects: t.labelContactProjects,
        notes: t.labelContactNotes,
      });
      const name = `${t.contactsTitle}.csv`;
      // text/csv with a charset, so a mail client does not decide it is Latin-1.
      const saved = await saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name);
      if (saved) toast.show(t.fileCreated(name));
    } catch (error) {
      log.error('contacts csv failed', error);
      toast.error(t.contactsExportFailed);
    } finally {
      finish();
    }
  };

  const importList = async (file: File) => {
    if (!begin('import')) return;
    try {
      // Names/numbers already visible in the table must participate in the
      // import's matching pass, even if their debounce has not elapsed.
      try {
        await flushAll();
      } catch {
        toast.error(t.contactSaveFailed);
        return;
      }
      const { csvToContacts } = await import('../lib/contactsCsv');
      const parsed = csvToContacts(await file.text());
      if (parsed.length === 0) {
        toast.error(t.contactsImportEmpty);
        return;
      }
      const { added, updated } = await importContacts(parsed);
      toast.show(t.contactsImported(added, updated));
    } catch (error) {
      log.error('contacts import failed', error);
      toast.error(t.contactsImportFailed);
    } finally {
      finish();
    }
  };

  const remove = async (row: Contact) => {
    if (row.id === undefined || !begin(`delete:${row.uid}`)) return;

    /*
     * Flush the pending edit before deleting. This both disarms its timer and
     * makes the undo payload the exact row the user saw. If that write fails,
     * deletion stops and the pending map keeps every typed character.
     */
    const latestRow = pendingRef.current.get(row.uid) ?? row;
    try {
      await flush(row.uid);
      await deleteContact(row.id);
      // An undo rather than a confirmation, as in the diary list: the question
      // costs everyone time, and the answer to a mistake is putting it back.
      toast.show(t.contactDeleted, {
        label: t.undo,
        run: () => void undoDelete(latestRow),
      });
    } catch (error) {
      log.error('contact deletion failed', error);
      toast.error(pendingRef.current.has(row.uid) ? t.contactSaveFailed : t.contactDeleteFailed);
    } finally {
      finish();
    }
  };

  const undoDelete = async (row: Contact) => {
    if (!begin(`restore:${row.uid}`)) return;
    try {
      await restoreContact(row);
      toast.show(t.contactRestored);
    } catch (error) {
      log.error('contact restore failed', error);
      // The first toast action is dismissed before it runs. Put the retry back
      // so a transient failure does not turn an undoable delete into a dead end.
      toast.show(t.contactRestoreFailed, {
        label: t.retry,
        run: () => void undoDelete(row),
      });
    } finally {
      finish();
    }
  };

  const retryPending = async () => {
    if (!begin('retry')) return;
    try {
      await flushAll();
    } catch {
      toast.error(t.contactSaveFailed);
    } finally {
      finish();
    }
  };

  /** The pending copy of a row wins, so typing is never rolled back mid-word. */
  const rows = useMemo(
    () => (stored ?? []).map((row) => pending.get(row.uid) ?? row),
    [stored, pending],
  );

  /** Position in the whole list, so a line keeps its number under a search. */
  const numbers = useMemo(
    () => new Map(rows.map((row, index) => [row.uid, index + 1])),
    [rows],
  );

  /**
   * The trades actually in the book, commonest first.
   *
   * Built from the list rather than from a fixed set: a site's suppliers are
   * the same handful of trades over and over, and which handful is different
   * for every site. Six is where a row of chips stops being scannable.
   */
  const trades = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const trade = row.trade.trim();
      if (trade) counts.set(trade, (counts.get(trade) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'he'))
      .slice(0, 6)
      .map(([trade]) => trade);
  }, [rows]);

  const shown = useMemo(() => {
    const byTrade = trade ? rows.filter((row) => row.trade.trim() === trade) : rows;
    const needle = query.trim().toLowerCase();
    if (!needle) return byTrade;
    return byTrade.filter((row) =>
      [row.name, row.trade, row.phone, row.projects, row.notes]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [rows, query, trade]);

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
          <div className="searchbox contacts__search">
            <Icon name="search" size={18} className="searchbox__icon" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchContacts}
              aria-label={t.searchContacts}
            />
          </div>
          <button type="button" className="btn btn--primary" disabled={busy !== null} onClick={() => void add()}>
            <Icon name="plus" size={17} />
            {busy === 'add' ? t.working : t.newContact}
          </button>
        </div>

        {/*
          The trades in the book, as one press each. A supplier list is
          searched for a *kind* of person far more often than for a name —
          "who does the plastering" — and typing the trade into the search box
          is the same answer three seconds later.
        */}
        {trades.length > 1 && (
          <div className="filterbar">
            <button
              type="button"
              className="filterbar__chip"
              aria-current={trade === ''}
              onClick={() => setTrade('')}
            >
              {t.filterAll}
              <span className="filterbar__count">{rows.length}</span>
            </button>
            {trades.map((name) => (
              <button
                key={name}
                type="button"
                className="filterbar__chip"
                aria-current={trade === name}
                onClick={() => setTrade(trade === name ? '' : name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        <div className="btn-row contacts__files">
          <button type="button" className="btn btn--sm" disabled={busy !== null} onClick={() => void printList()}>
            <Icon name="printer" size={17} />
            {busy === 'print' ? t.working : t.contactsPrint}
          </button>
          <button type="button" className="btn btn--sm" disabled={busy !== null} onClick={() => void exportList()}>
            <Icon name="download" size={17} />
            {busy === 'export' ? t.working : t.contactsExport}
          </button>
          {/* A label rather than a button: the file picker has to be opened by
              the input itself, and a styled label is the one way to do that
              without an invisible control jumping about the layout. */}
          <label className="btn btn--sm" aria-disabled={busy !== null || undefined}>
            <Icon name="upload" size={17} />
            {t.contactsImport}
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="visually-hidden"
              disabled={busy !== null}
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Cleared straight away, so choosing the same file twice in a
                // row still fires a change event the second time.
                e.target.value = '';
                if (file) void importList(file);
              }}
            />
          </label>
        </div>
      </div>

      {saveFailed && (
        <div className="card" role="alert" style={{ borderColor: 'var(--danger)' }}>
          <div className="card__body row row--wrap">
            <div className="grow">
              <strong>{t.contactSaveFailed}</strong>
              <p className="small muted">{t.contactSaveFailedBody}</p>
            </div>
            <button
              type="button"
              className="btn btn--sm"
              disabled={busy !== null}
              onClick={() => void retryPending()}
            >
              {t.retry}
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon="contacts" title={t.noContactsTitle}>
          <p className="muted" style={{ marginBottom: 16 }}>
            {t.noContactsBody}
          </p>
          <button type="button" className="btn btn--primary" disabled={busy !== null} onClick={() => void add()}>
            <Icon name="plus" size={17} />
            {t.newContact}
          </button>
        </EmptyState>
      ) : shown.length === 0 ? (
        <p className="muted">{t.noMatches}</p>
      ) : (
        <div className="ctable">
          {presets.trade.length > 0 && (
            <datalist id={TRADE_LIST_ID}>
              {presets.trade.map((trade) => (
                <option key={trade} value={trade} />
              ))}
            </datalist>
          )}

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
              index={numbers.get(row.uid) ?? 0}
              columns={columns}
              onEdit={edit}
              onBlur={() => void flush(row.uid).catch(() => undefined)}
              onDelete={() => void remove(row)}
              disabled={busy !== null}
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
  disabled,
}: {
  row: Contact;
  index: number;
  columns: { key: Column; label: string; placeholder: string }[];
  onEdit: (row: Contact, key: Column, value: string) => void;
  onBlur: () => void;
  onDelete: () => void;
  disabled: boolean;
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
            // Suggestions, never a closed list: a trade the diary has not seen
            // yet must still be typeable, which is what a datalist gives.
            list={column.key === 'trade' ? TRADE_LIST_ID : undefined}
            type={column.key === 'phone' ? 'tel' : 'text'}
            /* A phone number is Latin digits inside a Hebrew or Arabic page:
               without its own direction it renders with the sign and any dash
               in the wrong place. */
            dir={column.key === 'phone' ? 'ltr' : undefined}
            inputMode={column.key === 'phone' ? 'tel' : undefined}
            className={column.key === 'phone' ? 'ctable__input ctable__input--tel' : 'ctable__input'}
            data-first={column.key === 'name' ? row.uid : undefined}
            disabled={disabled}
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
            className="icon-btn icon-btn--call"
            href={`tel:${dialable}`}
            aria-label={t.callContact(row.name || t.unnamedContact)}
            title={t.callContact(row.name || t.unnamedContact)}
          >
            <Icon name="phone" size={17} />
          </a>
        )}
        <button
          type="button"
          className="icon-btn icon-btn--danger"
          disabled={disabled}
          onClick={onDelete}
          aria-label={t.deleteContact}
          title={t.deleteContact}
        >
          <Icon name="close" size={17} />
        </button>
      </div>
    </div>
  );
}
