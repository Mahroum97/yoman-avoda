/**
 * The diary's view menu: select mode, grid or list, and the sort order.
 *
 * A popover rather than a row of buttons, because the diary screen already
 * carries three actions across the top and a phone has no room for six. It
 * closes on an outside tap, on Escape, and on choosing anything — a menu that
 * stays open after a choice reads as broken on a touch screen.
 */
import { useEffect, useRef } from 'react';
import { useLanguage } from '../i18n/useLanguage';
import { navigate } from '../hooks/useRoute';
import { Icon } from './Icon';

import { SORT_KEYS, VIEW_MODES, type SortKey, type ViewMode } from './viewOptions';

export function ViewMenu({
  open,
  onOpenChange,
  mode,
  onModeChange,
  sort,
  onSortChange,
  descending,
  onDirectionChange,
  onStartSelecting,
  trashCount = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  sort: SortKey;
  onSortChange: (sort: SortKey) => void;
  descending: boolean;
  onDirectionChange: (descending: boolean) => void;
  onStartSelecting: () => void;
  /** How many pages are in the trash, for the badge. 0 hides the count. */
  trashCount?: number;
}) {
  const { t } = useLanguage();
  const wrapper = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    // `pointerdown` rather than `click`: on iOS a tap outside should dismiss the
    // menu without also activating whatever sits underneath it.
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  const choose = (run: () => void) => () => {
    run();
    onOpenChange(false);
  };

  const sortLabels: Record<SortKey, string> = {
    date: t.sortByDate,
    updated: t.sortByUpdated,
    status: t.sortByStatus,
  };

  return (
    <div className="viewmenu" ref={wrapper}>
      <button
        type="button"
        className="btn btn--icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.viewOptions}
        title={t.viewOptions}
        onClick={() => onOpenChange(!open)}
      >
        <Icon name="sort" size={20} />
      </button>

      {open && (
        <div className="viewmenu__panel" role="menu">
          <button type="button" className="viewmenu__item" role="menuitem" onClick={choose(onStartSelecting)}>
            <span className="viewmenu__tick" aria-hidden="true">
              <Icon name="select" size={18} />
            </span>
            {t.selectItems}
          </button>

          {/* The trash lives here rather than in the tab bar: it is somewhere
              you go on the rare day you deleted the wrong page, not one of the
              six places you work. The count is what makes it discoverable at
              the moment it matters. */}
          <button
            type="button"
            className="viewmenu__item"
            role="menuitem"
            onClick={choose(() => navigate('/trash'))}
          >
            <span className="viewmenu__tick" aria-hidden="true">
              <Icon name="trash" size={18} />
            </span>
            {t.trashTitle}
            {trashCount > 0 && <span className="viewmenu__badge">{trashCount}</span>}
          </button>

          <div className="viewmenu__rule" />

          {VIEW_MODES.map((id) => (
            <button
              key={id}
              type="button"
              className="viewmenu__item"
              role="menuitemradio"
              aria-checked={mode === id}
              onClick={choose(() => onModeChange(id))}
            >
              <span className="viewmenu__tick" aria-hidden="true">
                {mode === id && <Icon name="check" size={15} strokeWidth={2.4} />}
              </span>
              <span className="viewmenu__glyph" aria-hidden="true">
                <Icon name={id === 'grid' ? 'grid' : 'list'} size={18} />
              </span>
              {id === 'grid' ? t.viewGrid : t.viewList}
            </button>
          ))}

          <div className="viewmenu__rule" />
          <div className="viewmenu__heading">{t.sortHeading}</div>

          {SORT_KEYS.map((id) => (
            <button
              key={id}
              type="button"
              className="viewmenu__item"
              role="menuitemradio"
              aria-checked={sort === id}
              // Choosing the sort already in use flips its direction, which is
              // how the arrow beside it is meant to be read.
              onClick={choose(() =>
                sort === id ? onDirectionChange(!descending) : onSortChange(id),
              )}
            >
              <span className="viewmenu__tick" aria-hidden="true">
                {sort === id && <Icon name="check" size={15} strokeWidth={2.4} />}
              </span>
              <span className="viewmenu__glyph" aria-hidden="true">
                {sort === id ? (descending ? '▾' : '▴') : ''}
              </span>
              {sortLabels[id]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
