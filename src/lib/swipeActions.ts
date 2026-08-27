/**
 * What each swipe on a diary row does.
 *
 * The gestures themselves are not new — a row has been swiped to pin or to
 * delete since `SwipeRow` was written. What is stored here is *which* of the
 * row's actions sits behind each of the two gestures, because the two people
 * using this app do not agree about it: one deletes far more often than they
 * pin, and the other wants the destructive gesture off the row altogether.
 *
 * Only actions the row already has are offered. Nothing here can do anything
 * that pressing the row's own controls could not.
 *
 * The choice is kept per device, like the view and the sort and for the same
 * reason: it describes the hand holding the phone, not the diary. `none` is a
 * first-class answer — a swipe that does nothing is the right setting for
 * anyone who has ever deleted a day by accident.
 */
export const SWIPE_ACTIONS = ['pin', 'delete', 'export', 'none'] as const;

export type SwipeActionId = (typeof SWIPE_ACTIONS)[number];

/** Keyed by the edge the button appears at, so the setting survives a language change. */
export const SWIPE_KEYS = {
  start: 'diarySwipeStart',
  end: 'diarySwipeEnd',
} as const;

/** What the app has always done, and what it goes back to when nothing is stored. */
export const SWIPE_DEFAULTS: Record<'start' | 'end', SwipeActionId> = {
  start: 'pin',
  end: 'delete',
};

export function readSwipe(edge: 'start' | 'end'): SwipeActionId {
  try {
    const value = localStorage.getItem(SWIPE_KEYS[edge]);
    return (SWIPE_ACTIONS as readonly string[]).includes(value ?? '')
      ? (value as SwipeActionId)
      : SWIPE_DEFAULTS[edge];
  } catch {
    return SWIPE_DEFAULTS[edge];
  }
}

export function writeSwipe(edge: 'start' | 'end', action: SwipeActionId): void {
  try {
    localStorage.setItem(SWIPE_KEYS[edge], action);
  } catch {
    // A device that cannot store it keeps the default, which is what it had.
  }
}
