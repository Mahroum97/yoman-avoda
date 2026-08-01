/**
 * How the diary list is being viewed.
 *
 * Kept apart from `ViewMenu.tsx` because a module that exports both a component
 * and plain values loses fast refresh — the menu is edited often enough for
 * that to matter.
 */
export const VIEW_MODES = ['grid', 'list'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const SORT_KEYS = ['date', 'updated', 'status'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
