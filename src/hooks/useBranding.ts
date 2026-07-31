/**
 * The company logo that the exports print in their header band.
 *
 * Stored in the settings table as a data URL so it travels inside the backup
 * file with everything else.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, setSetting } from '../db';
import { prepareLogo, blobToDataUrl } from '../lib/images';

export const COMPANY_LOGO_KEY = 'companyLogo';

export function useCompanyLogo(): string | undefined {
  const value = useLiveQuery(async () => {
    await db.settings.get(COMPANY_LOGO_KEY); // keeps the query subscribed to changes
    return getSetting<string | null>(COMPANY_LOGO_KEY, null);
  }, []);
  return value ?? undefined;
}

export async function saveCompanyLogo(file: File | Blob): Promise<void> {
  const { blob } = await prepareLogo(file);
  await setSetting(COMPANY_LOGO_KEY, await blobToDataUrl(blob));
}

export async function clearCompanyLogo(): Promise<void> {
  await setSetting(COMPANY_LOGO_KEY, null);
}
