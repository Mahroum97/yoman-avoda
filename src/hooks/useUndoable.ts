/**
 * An undo/redo stack for a value held in local state.
 *
 * Built for the diary page editor, where a form is filled in over many small
 * steps and one mistaken tap — a cleared row, a signature drawn over, a wrong
 * date — used to be unrecoverable.
 *
 * Two things it has to get right to be worth having:
 *
 *  - **Not every change is a step.** Typing a sentence must undo as a sentence,
 *    not one letter at a time. Consecutive changes carrying the same `tag`
 *    inside `COALESCE_MS` fold into the step already on the stack.
 *  - **Not every change is the user's.** Adopting the id from a first save, or
 *    the status the database settled on, is bookkeeping the user did not do and
 *    must not be something they can undo. Those go through `amend`, which moves
 *    the value without touching the history.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

/** Steps kept. Snapshots share their photos by reference, so this is cheap. */
const MAX_STEPS = 60;
/** Changes to the same field closer together than this count as one step. */
const COALESCE_MS = 700;

interface Stack<T> {
  past: T[];
  present: T | null;
  future: T[];
}

export interface Undoable<T> {
  value: T | null;
  /** Applies a change and records it as an undoable step. */
  commit: (next: (current: T) => T, tag?: string) => void;
  /** Applies a change without creating a step. */
  amend: (next: (current: T) => T) => void;
  /** Installs a freshly loaded value and drops the history with it. */
  reset: (value: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoable<T>(): Undoable<T> {
  const [stack, setStack] = useState<Stack<T>>({ past: [], present: null, future: [] });
  /** What the last step was and when, so a burst of typing can be folded in. */
  const last = useRef<{ tag: string; at: number } | null>(null);

  const commit = useCallback((next: (current: T) => T, tag = '') => {
    const now = Date.now();
    const fold =
      last.current !== null && last.current.tag === tag && now - last.current.at < COALESCE_MS;
    last.current = { tag, at: now };

    setStack((s) => {
      if (s.present === null) return s;
      const value = next(s.present);
      // A change that changed nothing is not a step.
      if (value === s.present) return s;
      return {
        past: fold ? s.past : [...s.past, s.present].slice(-MAX_STEPS),
        present: value,
        // Editing after undoing abandons the redo branch, as everywhere else.
        future: [],
      };
    });
  }, []);

  const amend = useCallback((next: (current: T) => T) => {
    setStack((s) => (s.present === null ? s : { ...s, present: next(s.present) }));
  }, []);

  const reset = useCallback((value: T) => {
    last.current = null;
    setStack({ past: [], present: value, future: [] });
  }, []);

  const undo = useCallback(() => {
    // Whatever is typed next starts its own step rather than folding into the
    // one just stepped away from.
    last.current = null;
    setStack((s) => {
      if (s.present === null || s.past.length === 0) return s;
      return {
        past: s.past.slice(0, -1),
        present: s.past[s.past.length - 1],
        future: [s.present, ...s.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    last.current = null;
    setStack((s) => {
      if (s.present === null || s.future.length === 0) return s;
      return {
        past: [...s.past, s.present],
        present: s.future[0],
        future: s.future.slice(1),
      };
    });
  }, []);

  return useMemo(
    () => ({
      value: stack.present,
      commit,
      amend,
      reset,
      undo,
      redo,
      canUndo: stack.past.length > 0,
      canRedo: stack.future.length > 0,
    }),
    [stack, commit, amend, reset, undo, redo],
  );
}
