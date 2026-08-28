/**
 * One keydown listener for the whole app, mounted in the shell.
 *
 * It resolves what was pressed against the catalogue in `lib/shortcuts.ts` and
 * then presses the thing itself — the screen's published `PageAction`, the
 * editor's undo, a tab. Nothing here knows how to save or export; it knows how
 * to find the button that does.
 *
 * Three rules keep it from getting in the way of the diary being written:
 *
 *  - **A letter typed into a field is a letter.** Shortcuts with no modifier
 *    never fire while the caret is in an input, a textarea or a signature name.
 *    A few modified ones stand down there too, and say so themselves
 *    (`inField: 'skip'`): ⌘Z belongs to the field's own undo stack, and ⌘⌫ is
 *    "delete to the start of the line" on every Mac.
 *  - **A disabled action stays disabled.** The shortcut goes through the same
 *    `disabled`/`busy` flags the button is drawn with, so ⌘S during an export
 *    does what pressing the greyed-out button does: nothing.
 *  - **A held key fires once.** `event.repeat` is dropped — leaning on P is not
 *    a request for forty PDFs.
 */
import { useEffect, useRef } from 'react';
import { navigate } from './useRoute';
import { comboOf, hasModifier, isRecording, shortcutFor, type ShortcutDef } from '../lib/shortcuts';
import type { EditorActions, PageAction, PageActions } from './editorActionsContext';

/** What the shell itself owns, filled in by the buttons in the app bar. */
export interface ShellHandlers {
  backup?: () => void;
  theme?: () => void;
}

function inField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName);
}

/** The published action with this id, wherever in the bar it sits. */
function actionById(page: PageActions | null, id: string): PageAction | null {
  if (!page) return null;
  if (page.primary?.id === id) return page.primary;
  for (const group of page.groups) {
    const found = group.items.find((item) => item.id === id);
    if (found) return found;
  }
  return null;
}

export function useShortcuts(
  page: PageActions | null,
  actions: EditorActions | null,
  shell: React.RefObject<ShellHandlers>,
): void {
  /*
   * The listener is attached once and reads the current screen through a ref.
   * Re-attaching it every time the editor republishes its actions — which is
   * every keystroke of a caption — would be a listener churned hundreds of
   * times while a day is written.
   */
  const latest = useRef({ page, actions, shell });
  latest.current = { page, actions, shell };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      // The settings screen is waiting for this key in order to store it.
      if (isRecording()) return;

      const combo = comboOf(event);
      if (!combo) return;
      const def = shortcutFor(combo);
      if (!def) return;

      if (inField(event.target) && (!hasModifier(combo) || def.inField === 'skip')) return;

      const { page, actions, shell } = latest.current;
      if (!run(def, page, actions, shell.current)) return;
      // Claimed only once something actually answered, so an unused shortcut
      // still reaches the browser — ⌘S on a screen with nothing to save.
      event.preventDefault();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Presses it. `false` when there was nothing on this screen to press. */
function run(
  def: ShortcutDef,
  page: PageActions | null,
  actions: EditorActions | null,
  shell: ShellHandlers | null,
): boolean {
  const target = def.target;

  if (target.kind === 'route') {
    navigate(target.path);
    return true;
  }

  if (target.kind === 'action') {
    const action = actionById(page, target.action);
    if (!action || action.disabled || action.busy) return false;
    action.run();
    return true;
  }

  switch (target.app) {
    case 'undo':
      if (!actions?.canUndo) return false;
      actions.undo();
      return true;
    case 'redo':
      if (!actions?.canRedo) return false;
      actions.redo();
      return true;
    case 'backup':
      if (!shell?.backup) return false;
      shell.backup();
      return true;
    case 'theme':
      if (!shell?.theme) return false;
      shell.theme();
      return true;
  }
}
