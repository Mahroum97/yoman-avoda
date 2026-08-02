/**
 * Lets the screen currently being edited put undo and redo in the top bar.
 *
 * The history belongs to the diary page editor — it is the editor's draft that
 * is being stepped through — but the buttons belong in the app bar, where they
 * are reachable without scrolling back to the top of a long form. The editor
 * publishes its two functions here; the bar renders them when they are there
 * and nothing when they are not, so the buttons simply do not exist on screens
 * that have nothing to undo.
 */
import { createContext, useContext } from 'react';

export interface EditorActions {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export interface EditorActionsRegistry {
  actions: EditorActions | null;
  /** Called with the actions on mount, and with null on the way out. */
  publish: (actions: EditorActions | null) => void;
}

export const EditorActionsContext = createContext<EditorActionsRegistry>({
  actions: null,
  publish: () => {},
});

export function useEditorActions(): EditorActionsRegistry {
  return useContext(EditorActionsContext);
}
