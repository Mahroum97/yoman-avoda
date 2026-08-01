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
        ☰
      </button>

      {open && (
        <div className="viewmenu__panel" role="menu">
          <button type="button" className="viewmenu__item" role="menuitem" onClick={choose(onStartSelecting)}>
            <span className="viewmenu__tick" aria-hidden="true">
              ⊙
            </span>
            {t.selectItems}
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
                {mode === id ? '✓' : ''}
              </span>
              <span className="viewmenu__glyph" aria-hidden="true">
                {id === 'grid' ? '▦' : '☰'}
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
                {sort === id ? '✓' : ''}
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
