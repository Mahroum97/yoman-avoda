/**
 * Lets the screen you are looking at put its own actions in the app bar.
 *
 * It began as undo and redo: the history belongs to the diary page editor — it
 * is the editor's draft being stepped through — but the buttons belong at the
 * top, reachable without scrolling back up a long form.
 *
 * The same argument turned out to apply to everything else the editor could do.
 * Saving, exporting a PDF, a picture, a Word file, previewing, sharing, deleting
 * — seven buttons, wrapped across three rows, *underneath* a form long enough
 * that reaching them meant scrolling past the whole day's work. The action you
 * take most often was the furthest away from where you were typing.
 *
 * So a screen publishes what it can do, and the bar renders it: one primary
 * action as a button, and the rest grouped in a menu behind it. Screens that
 * publish nothing get no bar at all, which is how the diary list and the
 * settings screen are unaffected by any of this.
 */
import { createContext, useContext } from 'react';
import type { IconName } from '../components/Icon';

export interface EditorActions {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/** One thing this screen can do. */
export interface PageAction {
  id: string;
  label: string;
  icon: IconName;
  run: () => void;
  disabled?: boolean;
  /** Shown in place of the label while it runs — an export takes real time. */
  busyLabel?: string;
  busy?: boolean;
  /** Sets it apart in the menu, and keeps it last. Deleting is the only one. */
  danger?: boolean;
}

export interface PageActionGroup {
  /** A heading above the group, the way the share sheets people know are built. */
  title?: string;
  items: PageAction[];
}

export interface PageActions {
  /** Rendered as the filled button. The one thing you came to the screen to do. */
  primary?: PageAction;
  /** Everything else, behind the menu button beside it. */
  groups: PageActionGroup[];
  /** Heading at the top of the menu. */
  menuTitle: string;
}

export interface EditorActionsRegistry {
  actions: EditorActions | null;
  /** Called with the actions on mount, and with null on the way out. */
  publish: (actions: EditorActions | null) => void;
  page: PageActions | null;
  publishPage: (page: PageActions | null) => void;
}

export const EditorActionsContext = createContext<EditorActionsRegistry>({
  actions: null,
  publish: () => {},
  page: null,
  publishPage: () => {},
});

export function useEditorActions(): EditorActionsRegistry {
  return useContext(EditorActionsContext);
}
