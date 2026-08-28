/**
 * The bar of actions for whatever screen you are on, pinned under the app bar.
 *
 * The editor's seven buttons used to live at the *bottom* of the form — save,
 * PDF, share, picture, Word, preview, delete, wrapped over three rows. On a
 * day's page with two crew tables and a photo grid above them, the button you
 * press most often was a full screen of scrolling away from where you were
 * typing. The same was true of the range report, whose entire purpose is the
 * button that was underneath it.
 *
 * Two things make this work in the width a phone actually has:
 *
 *  - **One action is a button; the rest are a menu.** Save is what you came to
 *    do, so it stays visible. Six more filled pills beside it would be the
 *    bottom row again, moved.
 *  - **It is its own row, not squeezed into the app bar.** The bar already
 *    carries the project, undo, redo, backup and the theme; on a 390px screen
 *    there is no room left, and cramming them together would cost the title.
 *
 * The menu follows the share sheets people already use: a heading, then groups
 * with their own headings, then rows of icon and label. Destructive actions are
 * last and set apart, because a menu where "delete" sits between two exports is
 * a menu that will eventually be misread.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditorActions, type PageAction } from '../hooks/editorActionsContext';
import { useEscape } from '../hooks/useEscape';
import { useLanguage } from '../i18n/useLanguage';
import { keyLabelForAction } from '../lib/shortcuts';
import { Icon } from './Icon';

const SHEET_WIDTH = 300;
const EDGE = 12;
const GAP = 8;

function label(action: PageAction): string {
  return action.busy && action.busyLabel ? action.busyLabel : action.label;
}

export function PageActionsBar() {
  const { page } = useEditorActions();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  /*
   * The menu is a portal on `document.body`, and that is not a stylistic
   * choice.
   *
   * The bar is frosted — `backdrop-filter` — and in Chrome anything with a
   * backdrop filter turns its whole subtree into a backdrop root: an opaque
   * white card inside it, `opacity: 1`, renders *see-through*, with the form
   * underneath legible straight through the menu. Moving the blur to a
   * pseudo-element does not help, because the pseudo is still in the subtree.
   * Out of the subtree entirely is the only fix, and it makes the menu immune
   * to clipping by the bar on a narrow screen at the same time.
   */
  const place = useCallback(() => {
    const anchor = button.current?.getBoundingClientRect();
    if (!anchor) return;
    const width = Math.min(SHEET_WIDTH, window.innerWidth - EDGE * 2);
    // Centred under the button, then held inside the viewport — which is what
    // keeps it on screen when the button sits near either edge.
    const centred = anchor.left + anchor.width / 2 - width / 2;
    const left = Math.max(EDGE, Math.min(centred, window.innerWidth - width - EDGE));
    setAt({ top: anchor.bottom + GAP, left, width });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    // The bar is sticky, so scrolling barely moves it — but "barely" is not
    // "never", and a menu that drifts off its button looks broken.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  // Escape closes the menu before anything outer reacts to it — the same stack
  // the preview and the dialogs are on, so a second press leaves the screen.
  useEscape(open ? () => setOpen(false) : null);

  // A press anywhere else closes it. `pointerdown` rather than `click` so the
  // menu is gone before whatever was pressed underneath begins to react.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (button.current?.contains(target) || sheet.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  // Published by the screen; absent on the ones with nothing to publish, and
  // the bar then does not exist rather than standing there empty.
  if (!page) return null;
  const { primary, groups, menuTitle, sections, current, onSection } = page;
  const hasMenu = groups.some((group) => group.items.length > 0);

  const run = (action: PageAction) => {
    setOpen(false);
    action.run();
  };

  return (
    <div className="actionbar">
      <div className="actionbar__inner">
        {primary && (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={primary.disabled || primary.busy}
            onClick={() => primary.run()}
          >
            <Icon name={primary.icon} size={17} />
            {label(primary)}
          </button>
        )}

        {hasMenu && (
          <button
            ref={button}
            type="button"
            className="actionmenu__button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={menuTitle}
            title={menuTitle}
            onClick={() => setOpen((was) => !was)}
          >
            <Icon name="share" size={19} />
            <Icon name="chevron" size={13} className="actionmenu__caret" />
          </button>
        )}
      </div>

      {/*
        * The screen's sections, in the one sticky element there is room for.
        *
        * It scrolls sideways rather than wrapping: ten chips wrapped over three
        * rows would be the problem the bar was built to solve, back again and
        * a row higher up the screen.
        */}
      {sections && sections.length > 0 && (
        <div className="sectionrail">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`sectionrail__chip${section.done ? ' sectionrail__chip--done' : ''}`}
              aria-current={section.id === current}
              onClick={() => onSection?.(section.id)}
            >
              <span className="sectionrail__dot" />
              {section.label}
            </button>
          ))}
        </div>
      )}

      {open &&
        at &&
        createPortal(
          <div
            ref={sheet}
            className="actionmenu__sheet"
            role="menu"
            style={{ top: at.top, left: at.left, width: at.width }}
          >
            <p className="actionmenu__title">{menuTitle}</p>
            {groups.map((group, index) => (
              <div className="actionmenu__group" key={group.title ?? index}>
                {group.title && <p className="actionmenu__heading">{group.title}</p>}
                <div className="actionmenu__items">
                  {group.items.map((action) => {
                    /*
                      The key beside the action is how a shortcut is learned.
                      Nobody opens a settings screen to find out that P makes a
                      PDF; they see it here every time they reach for the menu,
                      and one day they stop reaching for the menu.

                      `dir="ltr"` because `⌘ ⇧ Z` set loose in a Hebrew row is
                      reordered into `Z ⇧ ⌘` by the paragraph around it — the
                      same trap the PDF's dates are guarded against.
                    */
                    const key = keyLabelForAction(action.id);
                    return (
                      <button
                        key={action.id}
                        type="button"
                        role="menuitem"
                        className={`actionmenu__item${action.danger ? ' actionmenu__item--danger' : ''}`}
                        disabled={action.disabled || action.busy}
                        onClick={() => run(action)}
                      >
                        <Icon name={action.icon} size={19} />
                        <span>{label(action)}</span>
                        {key && (
                          <span className="actionmenu__key" dir="ltr">
                            {key}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>,
          document.body,
        )}

      {/* Named for the screen reader; the visible text is on the buttons. */}
      <span className="sr-only">{t.pageActions}</span>
    </div>
  );
}
