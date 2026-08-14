/**
 * One diary page as a tile, for the grid view.
 *
 * The preview is the page's first photo when it has one, because that is what
 * makes a day recognisable at a glance on a site — far more than its date does.
 * Days without photos fall back to the day number on a ruled sheet, so the grid
 * stays even instead of collapsing into empty boxes.
 */
import { useEffect, useState } from 'react';
import type { DiaryEntry } from '../types';
import { weekday } from '../lib/dates';
import { useLanguage } from '../i18n/useLanguage';
import { StatusChip } from './ui';
import { Icon } from './Icon';

function usePhotoUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();

  // Minted and revoked in the same effect, deliberately. Creating the URL while
  // rendering and revoking it in a cleanup breaks under StrictMode's
  // double-invoked effects: the second mount revokes the first mount's URL and
  // the image goes blank.
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const made = URL.createObjectURL(blob);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [blob]);

  return url;
}

export function EntryTile({
  entry,
  selecting,
  selected,
  onOpen,
  onToggle,
}: {
  entry: DiaryEntry;
  selecting: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  const photo = usePhotoUrl(entry.photos[0]?.blob);

  return (
    <button
      type="button"
      className={`tile${selected ? ' tile--selected' : ''}`}
      aria-pressed={selecting ? selected : undefined}
      onClick={selecting ? onToggle : onOpen}
    >
      <span className="tile__preview">
        {photo ? (
          <img src={photo} alt="" loading="lazy" />
        ) : (
          <span className="tile__sheet" aria-hidden="true">
            <span className="tile__day">{entry.date.slice(8)}</span>
          </span>
        )}
        {selecting && (
          <span className={`tile__check${selected ? ' tile__check--on' : ''}`} aria-hidden="true">
            {selected && <Icon name="check" size={14} strokeWidth={2.6} />}
          </span>
        )}
        {entry.photos.length > 1 && (
          <span className="tile__count" aria-hidden="true">
            📷 {entry.photos.length}
          </span>
        )}
        {entry.pinned && (
          <span className="tile__pin" title={t.pinnedHeading}>
            📌
          </span>
        )}
      </span>

      <span className="tile__label">
        <span className="tile__title">
          {entry.date.slice(8)}/{entry.date.slice(5, 7)} · {weekday(entry.date, t)}
        </span>
        <span className="tile__sub">
          {entry.workDescription.split('\n')[0] || t.noDescription}
        </span>
      </span>

      <span className="tile__status">
        <StatusChip status={entry.status} />
      </span>
    </button>
  );
}
