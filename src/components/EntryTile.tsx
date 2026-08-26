/**
 * One diary page as a tile, for the grid view.
 *
 * The preview is the page's first photo when it has one, because that is what
 * makes a day recognisable at a glance on a site — far more than its date does.
 * Days without photos fall back to the day number on a ruled sheet, so the grid
 * stays even instead of collapsing into empty boxes.
 */
import { useMemo } from 'react';
import type { DiaryEntry } from '../types';
import { weekdayShort } from '../lib/dates';
import { usePhotoUrls } from '../hooks/usePhotoUrls';
import { useLanguage } from '../i18n/useLanguage';
import { StatusChip } from './ui';
import { Icon } from './Icon';

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
  // Only the first photo is shown, so only the first is read: a month of tiles
  // holding every photograph of every day would be the whole diary in memory.
  const first = useMemo(() => entry.photos.slice(0, 1), [entry.photos]);
  const { urls, retry } = usePhotoUrls(first);
  const cover = first[0];
  const photo = cover ? urls[cover.id] : undefined;

  return (
    <button
      type="button"
      className={`tile${selected ? ' tile--selected' : ''}`}
      aria-pressed={selecting ? selected : undefined}
      onClick={selecting ? onToggle : onOpen}
    >
      <span className="tile__preview">
        {photo ? (
          <img
            src={photo}
            alt=""
            loading="lazy"
            onError={() => cover && retry(cover.id)}
          />
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
            <Icon name="image" size={13} />
            {entry.photos.length}
          </span>
        )}
        {entry.pinned && (
          <span className="tile__pin" title={t.pinnedHeading}>
            <Icon name="pin" size={14} strokeWidth={2} />
          </span>
        )}
      </span>

      <span className="tile__label">
        <span className="tile__title">
          {entry.date.slice(8)}/{entry.date.slice(5, 7)} · {weekdayShort(entry.date, t)}
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
