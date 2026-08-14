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
import { useMemo, useState } from 'react';
import type { DiaryEntry, Project } from '../types';
import { emptyTrash, purgeEntry, restoreFromTrash } from '../db';
import { useTrashedEntries } from '../hooks/useData';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { navigate } from '../hooks/useRoute';
import { useEscape } from '../hooks/useEscape';
import { formatDdMmYyyy, formatLongDate } from '../lib/dates';
import { EmptyState, StatusChip } from '../components/ui';
import { logger } from '../lib/log';

const log = logger('trash');

export function TrashScreen({ project }: { project?: Project }) {
  const rows = useTrashedEntries(project?.id);
  const toast = useToast();
  const { t } = useLanguage();
  const [picked, setPicked] = useState<Set<number>>(new Set());

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
    let done = 0;
    let clashed = false;
    for (const entry of entries) {
      if (entry.id === undefined) continue;
      try {
        await restoreFromTrash(entry.id);
        done += 1;
      } catch (error) {
        // One page per project per day: a date written again while this copy
        // sat in the trash cannot take both. Reported once, not once per page.
        clashed = true;
        log.warn('restore refused — a page already exists for that date', error);
      }
    }
    setPicked(new Set());
    if (done > 0) toast.show(t.trashRestored(done));
    if (clashed) toast.error(t.trashClash);
  };

  const purge = async (entries: DiaryEntry[]) => {
    // The one destructive action in the app that cannot be undone, so it is the
    // one place a confirmation earns its interruption.
    if (!window.confirm(t.confirmPurge(entries.length))) return;
    let done = 0;
    for (const entry of entries) {
      if (entry.id === undefined) continue;
      await purgeEntry(entry.id);
      done += 1;
    }
    setPicked(new Set());
    toast.show(t.trashPurged(done));
  };

  const emptyAll = async () => {
    const all = rows ?? [];
    if (all.length === 0) return;
    if (!window.confirm(t.confirmPurge(all.length))) return;
    const count = await emptyTrash(project?.id);
    setPicked(new Set());
    toast.show(t.trashPurged(count));
  };

  // Escape clears a selection first, and only then leaves the screen — one
  // press per layer, the same rule the rest of the app follows.
  useEscape(chosen.length > 0 ? () => setPicked(new Set()) : () => navigate('/'));

  if (!rows) return <p className="muted">{t.loading}</p>;

  return (
    <div className={chosen.length > 0 ? 'has-selectionbar' : undefined}>
      <div className="row row--wrap" style={{ marginBottom: 8 }}>
        <h1 className="grow">{t.trashTitle}</h1>
        <button type="button" className="btn btn--sm" onClick={() => navigate('/')}>
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
            <button type="button" className="btn btn--sm btn--danger" onClick={() => void emptyAll()}>
              {t.trashEmptyAll}
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
                      onClick={(e) => {
                        e.preventDefault();
                        void restore([entry]);
                      }}
                    >
                      {t.trashRestore}
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
          <button type="button" className="btn btn--sm" onClick={() => void restore(chosen)}>
            {t.trashRestore}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            onClick={() => void purge(chosen)}
          >
            {t.trashDeleteForever}
          </button>
          <button type="button" className="btn btn--sm" onClick={() => setPicked(new Set())}>
            {t.cancel}
          </button>
        </div>
      )}
    </div>
  );
}
