/**
 * One way to put a generated file in front of the user, on all three platforms.
 *
 *  - macOS app  → a real "save as" dialog through the Electron preload bridge.
 *  - iPhone app → written to the app's documents folder, then handed to the iOS
 *    share sheet, because iOS has no downloads folder and a `<a download>` in a
 *    web view silently does nothing.
 *  - Browser    → the Web Share sheet when the device offers it (this is what
 *    makes "Save to Files" work in Safari on iOS), otherwise a plain download.
 */
import { saveAs } from 'file-saver';

export interface DesktopBridge {
  saveFile: (
    name: string,
    data: Uint8Array,
  ) => Promise<{ saved: boolean; path?: string }>;
  platform: string;
  version: string;
}

declare global {
  interface Window {
    yoman?: DesktopBridge;
  }
}

export const isDesktop = (): boolean => typeof window !== 'undefined' && !!window.yoman;

/** True inside the Capacitor native shell (the iPhone app). */
export function isNativeApp(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/** iOS in any form: the native app, an installed PWA, or Safari. */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac, but a Mac has no touch screen.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  json: 'application/json',
};

function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}

/* --------------------------------------------------------------- native iOS */

async function saveNative(blob: Blob, name: string): Promise<boolean> {
  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);

    const base64 = await blobToBase64(blob);
    // Cache, not Documents: these are exports on their way to the share sheet,
    // not the diary itself, which lives in IndexedDB.
    const written = await Filesystem.writeFile({
      path: name,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });

    await Share.share({ title: name, files: [written.uri] });
    return true;
  } catch (error) {
    // A user dismissing the share sheet throws too; nothing to recover from.
    if (import.meta.env.DEV) console.warn('native share failed', error);
    return false;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/* ------------------------------------------------------------- web browsers */

async function saveViaWebShare(blob: Blob, name: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false;
  const file = new File([blob], name, { type: blob.type || mimeFor(name) });
  if (!navigator.canShare({ files: [file] })) return false;

  try {
    await navigator.share({ files: [file], title: name });
    return true;
  } catch (error) {
    // AbortError means the user closed the sheet — that is a completed action,
    // not a failure to fall back from.
    if ((error as DOMException)?.name === 'AbortError') return true;
    return false;
  }
}

/* -------------------------------------------------------------------- entry */

export async function saveBlob(blob: Blob, name: string): Promise<void> {
  if (window.yoman) {
    await window.yoman.saveFile(name, new Uint8Array(await blob.arrayBuffer()));
    return;
  }

  if (isNativeApp() && (await saveNative(blob, name))) return;

  // On iOS the share sheet is the only route to Files, Mail or WhatsApp.
  if (isIos() && (await saveViaWebShare(blob, name))) return;

  saveAs(blob, name);
}

export async function saveBinary(
  bytes: Uint8Array,
  name: string,
  mime: string,
): Promise<void> {
  await saveBlob(new Blob([bytes as BlobPart], { type: mime }), name);
}
