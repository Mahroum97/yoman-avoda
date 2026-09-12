/**
 * סל מחיקה — where a deleted diary page waits.
 *
 * Deleting a page is a soft delete: it leaves the list, leaves every report,
 * and lands here. Only this screen destroys anything, and only deliberately —
 * a day's page is the account of what happened on a site, and an undo toast
 * that lasts seven seconds is not long enough to notice the wrong one went.
 *
 * Selection is always on, unlike the diary list's separate select mode. Picking
 * several and restoring them together is the *usual* thing to do here rather
 * than an occasional one, so there is nothing to switch into first.
 */
import { useMemo, useRef, useState } from 'react';
import type { DiaryEntry, Project } from '../types';
import { emptyTrash, EntryDateConflictError, purgeEntry, restoreFromTrash } from '../db';
import { useTrashedEntries } from '../hooks/useData';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { navigate } from '../hooks/useRoute';
import { useEscape } from '../hooks/useEscape';
import { formatDdMmYyyy, formatLongDate } from '../lib/dates';
import { EmptyState, StatusChip } from '../components/ui';
import { Icon } from '../components/Icon';
import { logger } from '../lib/log';

const log = logger('trash');

export function TrashScreen({ project }: { project?: Project }) {
  const rows = useTrashedEntries(project?.id);
  const toast = useToast();
  const { t } = useLanguage();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<'restore' | 'purge' | 'empty' | null>(null);
  const inFlight = useRef(false);

  const begin = (operation: 'restore' | 'purge' | 'empty') => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(operation);
    return true;
  };

  const finish = () => {
    inFlight.current = false;
    setBusy(null);
  };

  const chosen = useMemo(
    () => (rows ?? []).filter((row) => row.id !== undefined && picked.has(row.id)),
    [rows, picked],
  );

  const toggle = (id: number) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const restore = async (entries: DiaryEntry[]) => {
    if (!begin('restore')) return;
    let done = 0;
    let clashed = false;
    let failed = false;
    const restored = new Set<number>();
    try {
      for (const entry of entries) {
        if (entry.id === undefined) continue;
        try {
          await restoreFromTrash(entry.id);
          restored.add(entry.id);
          done += 1;
        } catch (error) {
          if (error instanceof EntryDateConflictError) {
            // One page per project per day: a date written again while this
            // copy sat in the trash cannot take both.
            clashed = true;
            log.warn('restore refused — a page already exists for that date', error);
            continue;
          }
          failed = true;
          log.error('trash restore failed', error);
          break;
        }
      }
      // Successful rows leave the selection. Failed and unattempted rows stay
      // selected, so Retry still acts on exactly what remains on screen.
      setPicked((current) => new Set([...current].filter((id) => !restored.has(id))));
      if (done > 0) toast.show(t.trashRestored(done));
      if (clashed) toast.error(t.trashClash);
      if (failed) toast.error(t.trashActionFailed);
    } finally {
      finish();
    }
  };

  const purge = async (entries: DiaryEntry[]) => {
    if (!begin('purge')) return;
    // The one destructive action in the app that cannot be undone, so it is the
    // one place a confirmation earns its interruption.
    if (!window.confirm(t.confirmPurge(entries.length))) {
      finish();
      return;
    }
    let done = 0;
    const purged = new Set<number>();
    let failed = false;
    try {
      for (const entry of entries) {
        if (entry.id === undefined) continue;
        try {
          await purgeEntry(entry.id);
          purged.add(entry.id);
          done += 1;
        } catch (error) {
          failed = true;
          log.error('permanent page deletion failed', error);
          break;
        }
      }
      setPicked((current) => new Set([...current].filter((id) => !purged.has(id))));
      if (done > 0) toast.show(t.trashPurged(done));
      if (failed) toast.error(t.trashActionFailed);
    } finally {
      finish();
    }
  };

  const emptyAll = async () => {
    const all = rows ?? [];
    if (all.length === 0 || !begin('empty')) return;
    if (!window.confirm(t.confirmPurge(all.length))) {
      finish();
      return;
    }
    try {
      const count = await emptyTrash(project?.id);
      setPicked(new Set());
      toast.show(t.trashPurged(count));
    } catch (error) {
      log.error('empty trash failed', error);
      toast.error(t.trashActionFailed);
    } finally {
      finish();
    }
  };

  // Escape clears a selection first, and only then leaves the screen — one
  // press per layer, the same rule the rest of the app follows.
  useEscape(busy !== null ? null : chosen.length > 0 ? () => setPicked(new Set()) : () => navigate('/'));

  if (!rows) return <p className="muted">{t.loading}</p>;

  return (
    <div className={chosen.length > 0 ? 'has-selectionbar' : undefined}>
      <div className="row row--wrap" style={{ marginBottom: 8 }}>
        <h1 className="grow">{t.trashTitle}</h1>
        <button type="button" className="btn btn--sm" disabled={busy !== null} onClick={() => navigate('/')}>
          <Icon name="chevron" size={15} className="icon--back" />
          {t.backToDiary}
        </button>
      </div>
      <p className="muted small" style={{ marginBottom: 16 }}>
        {t.trashBlurb}
      </p>

      {rows.length === 0 ? (
        <EmptyState icon="trash" title={t.trashEmptyTitle}>
          <p className="muted">{t.trashEmptyBody}</p>
        </EmptyState>
      ) : (
        <>
          <div className="btn-row" style={{ marginBottom: 14 }}>
            <button type="button" className="btn btn--sm btn--danger" disabled={busy !== null} onClick={() => void emptyAll()}>
              {busy === 'empty' ? t.working : t.trashEmptyAll}
            </button>
          </div>

          <div className="stack">
            {rows.map((entry) => {
              const id = entry.id;
              if (id === undefined) return null;
              const isPicked = picked.has(id);
              return (
                <label className="trash-row" key={entry.uid} data-picked={isPicked || undefined}>
                  <input
                    type="checkbox"
                    className="trash-row__pick"
                    checked={isPicked}
                    disabled={busy !== null}
                    onChange={() => toggle(id)}
                  />
                  <div className="grow">
                    <div className="row row--wrap" style={{ gap: 8 }}>
                      <strong>{formatLongDate(entry.date, t)}</strong>
                      <StatusChip status={entry.status} />
                    </div>
                    <p className="muted small">
                      {t.trashDeletedOn(
                        entry.deletedAt
                          ? formatDdMmYyyy(new Date(entry.deletedAt).toISOString().slice(0, 10))
                          : '—',
                      )}
                      {entry.photos.length > 0 && ` · ${t.photosShort(entry.photos.length)}`}
                    </p>
                  </div>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={busy !== null}
                      onClick={(e) => {
                        e.preventDefault();
                        void restore([entry]);
                      }}
                    >
                      {busy === 'restore' ? t.working : t.trashRestore}
                    </button>
                  </div>
                </label>
              );
            })}
          </div>
        </>
      )}

      {chosen.length > 0 && (
        <div className="selectionbar">
          <span className="selectionbar__count">{t.selectedCount(chosen.length)}</span>
          <button type="button" className="btn btn--sm" disabled={busy !== null} onClick={() => void restore(chosen)}>
            {busy === 'restore' ? t.working : t.trashRestore}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            disabled={busy !== null}
            onClick={() => void purge(chosen)}
          >
            {busy === 'purge' ? t.working : t.trashDeleteForever}
          </button>
          <button type="button" className="btn btn--sm" disabled={busy !== null} onClick={() => setPicked(new Set())}>
            {t.cancel}
          </button>
        </div>
      )}
    </div>
  );
}
