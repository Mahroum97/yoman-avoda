/**
 * The two signatures that repeat on every page: the site manager's and the
 * supervisor's.
 *
 * They live in the settings table rather than on an entry because they belong
 * to the person, not to the day — signing a diary page by hand every morning on
 * a phone is the part of the job the app is supposed to remove. An entry still
 * stores its own copy once applied, so a page that was signed stays signed even
 * if the saved signature is later changed or deleted.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, setSetting } from '../db';
import { blobToDataUrl, prepareSignature } from '../lib/images';

export const SIGNATURE_ROLES = ['manager', 'supervisor'] as const;
export type SignatureRole = (typeof SIGNATURE_ROLES)[number];

export const signatureKey = (role: SignatureRole): string => `signature.${role}`;

export function useSavedSignature(role: SignatureRole): string | undefined {
  const value = useLiveQuery(async () => {
    const key = signatureKey(role);
    await db.settings.get(key); // keeps the query subscribed to changes
    return getSetting<string | null>(key, null);
  }, [role]);
  return value ?? undefined;
}

/** Both at once, for the editor, which offers each beside its own pad. */
export function useSavedSignatures(): Record<SignatureRole, string | undefined> {
  const manager = useSavedSignature('manager');
  const supervisor = useSavedSignature('supervisor');
  return { manager, supervisor };
}

/** Stores a signature drawn on the pad, which is already a PNG data URL. */
export async function saveDrawnSignature(role: SignatureRole, dataUrl: string): Promise<void> {
  await setSetting(signatureKey(role), dataUrl || null);
}

/** Stores a photographed or scanned signature, with its paper removed. */
export async function saveSignatureImage(role: SignatureRole, file: File | Blob): Promise<void> {
  const { blob } = await prepareSignature(file);
  await setSetting(signatureKey(role), await blobToDataUrl(blob));
}

export async function clearSavedSignature(role: SignatureRole): Promise<void> {
  await setSetting(signatureKey(role), null);
}
