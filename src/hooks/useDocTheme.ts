/**
 * The chosen document look. Stored in the settings table rather than
 * localStorage, so it travels with sync and with a backup — the look of a
 * company's reports belongs to the diary, not to one device.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, setSetting } from '../db';
import { DEFAULT_DOC_THEME, DOC_THEME_KEY, type DocThemeId } from '../docTheme';

export function useDocThemeId(): DocThemeId {
  const value = useLiveQuery(async () => {
    await db.settings.get(DOC_THEME_KEY); // keeps the query subscribed
    return getSetting<string | null>(DOC_THEME_KEY, null);
  }, []);
  return (value as DocThemeId) ?? DEFAULT_DOC_THEME;
}

export async function setDocThemeId(id: DocThemeId): Promise<void> {
  await setSetting(DOC_THEME_KEY, id);
}

/** For the export helpers, which run outside React. */
export async function currentDocThemeId(): Promise<DocThemeId> {
  return ((await getSetting<string | null>(DOC_THEME_KEY, null)) as DocThemeId) ?? DEFAULT_DOC_THEME;
}
