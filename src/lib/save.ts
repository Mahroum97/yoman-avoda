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
import { fileKind, logger } from './log';

const log = logger('save');

export interface SyncServerStatus {
  /** The socket is bound — not merely that a server object exists. */
  running: boolean;
  address: string | null;
  code: string | null;
  lastSyncAt: number | null;
  /** Why the port could not be taken; `EADDRINUSE` in practice. */
  error?: string | null;
  /** A rebind is already scheduled, so there is nothing for the user to do. */
  retrying?: boolean;
}

export interface DesktopBridge {
  saveFile: (
    name: string,
    data: Uint8Array,
  ) => Promise<{ saved: boolean; path?: string }>;
  /**
   * Writes a dated backup with no dialog, into a folder the main process picks.
   * Absent on older builds of the Mac app, which is why every call is guarded.
   */
  autoBackup?: (
    name: string,
    data: Uint8Array,
  ) => Promise<{ saved: boolean; path?: string; kept?: number; error?: string }>;
  /** The macOS share sheet. Absent on older builds of the Mac app. */
  shareFile?: (
    name: string,
    data: Uint8Array,
  ) => Promise<{ shared: boolean; error?: string }>;
  platform: string;
  version: string;
  /** Present only in the Mac app, which hosts local-network sync. */
  sync?: {
    status: () => Promise<SyncServerStatus>;
    newCode: () => Promise<SyncServerStatus>;
    start: () => Promise<SyncServerStatus>;
    stop: () => Promise<SyncServerStatus>;
    onRequest: (handler: (exchange: unknown) => Promise<unknown>) => void;
  };
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
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
  txt: 'text/plain',
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
    log.info('shared via iOS share sheet', { kind: fileKind(name), bytes: blob.size });
    return true;
  } catch (error) {
    // A user dismissing the share sheet throws too, so this is a warning rather
    // than an error — but it is recorded either way, because "I pressed export
    // and nothing happened" is otherwise indistinguishable from a real failure.
    log.warn('native share failed or was dismissed', error);
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
    log.info('shared via web share', { kind: fileKind(name), bytes: blob.size });
    return true;
  } catch (error) {
    // AbortError means the user closed the sheet — that is a completed action,
    // not a failure to fall back from.
    if ((error as DOMException)?.name === 'AbortError') {
      log.debug('share sheet dismissed', { kind: fileKind(name) });
      return true;
    }
    log.warn('web share failed', error);
    return false;
  }
}

/* -------------------------------------------------------------------- entry */

/**
 * Puts the file in front of the user, and says whether that actually happened.
 *
 * The return value is the whole point. This used to be `Promise<void>`, so a
 * caller had no way to tell a saved file from a cancelled dialog and every
 * export ended in "הקובץ נוצר" either way — including the two cancels sitting
 * in the log, one of them a nine-page export-all the user never received.
 * Worse on the phone: with no share route left, `saveAs` in a web view does
 * nothing whatsoever, silently, and the app still claimed success.
 *
 * False means the file did not reach the user. It is not an error — cancelling
 * is a normal thing to do — so callers should stay quiet rather than complain,
 * but they must not announce a file that does not exist.
 */
export async function saveBlob(blob: Blob, name: string): Promise<boolean> {
  // Which branch a file took is the first question when an export "does
  // nothing", because the four routes fail in completely different ways.
  log.debug('saving file', { kind: fileKind(name), bytes: blob.size });

  if (window.yoman) {
    const result = await window.yoman.saveFile(name, new Uint8Array(await blob.arrayBuffer()));
    if (!result.saved) {
      log.info('save dialog cancelled', { kind: fileKind(name) });
      return false;
    }
    log.info('saved via desktop dialog', { kind: fileKind(name), bytes: blob.size });
    return true;
  }

  if (isNativeApp() && (await saveNative(blob, name))) return true;

  // On iOS the share sheet is the only route to Files, Mail or WhatsApp.
  if (isIos() && (await saveViaWebShare(blob, name))) return true;

  // There is no downloads folder in a web view, so `saveAs` there is not a last
  // resort — it is nothing at all. Reporting it as a save is how "I pressed
  // export and nothing happened" became impossible to tell apart from a
  // working export.
  if (isNativeApp()) {
    log.error('no way to deliver the file on this device', { kind: fileKind(name) });
    return false;
  }

  saveAs(blob, name);
  log.info('saved via browser download', { kind: fileKind(name) });
  return true;
}

export async function saveBinary(
  bytes: Uint8Array,
  name: string,
  mime: string,
): Promise<boolean> {
  return saveBlob(new Blob([bytes as BlobPart], { type: mime }), name);
}

/* -------------------------------------------------------------------- share */

/**
 * Whether this device can hand a file to other apps.
 *
 * Used to decide whether to offer a share button at all: on a plain desktop
 * browser there is nothing behind it but a download, which the export buttons
 * already do, so a second button that does the same thing would be a lie.
 */
export function canShareFiles(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.yoman) return !!window.yoman.shareFile && window.yoman.platform === 'darwin';
  if (isNativeApp()) return true;
  return typeof navigator !== 'undefined' && !!navigator.canShare;
}

/**
 * Hands a finished file to the system share sheet — WhatsApp, Mail, AirDrop.
 *
 * The distinction from `saveBlob` only exists on the Mac. On iOS the two are
 * the same thing, because the share sheet *is* how a file leaves the app;
 * on the Mac saving opens a file dialog and sharing opens the picker, and the
 * report someone wants to send to the site manager needs the second one.
 *
 * Returns false when nothing could be opened, so the caller can say so rather
 * than leaving the user staring at a button that did nothing.
 */
export async function shareBlob(blob: Blob, name: string): Promise<boolean> {
  log.debug('sharing file', { kind: fileKind(name), bytes: blob.size });

  const bridge = window.yoman;
  if (bridge?.shareFile) {
    const result = await bridge.shareFile(name, new Uint8Array(await blob.arrayBuffer()));
    log.info('shared via desktop share sheet', {
      kind: fileKind(name),
      shared: result.shared,
    });
    if (result.shared) return true;
    // The Mac app on a platform without a share sheet, or a failure writing the
    // temporary copy: saving is still better than nothing happening — but only
    // if the save itself went through, which is the caller's answer too.
    return saveBlob(blob, name);
  }

  if (isNativeApp() && (await saveNative(blob, name))) return true;
  if (await saveViaWebShare(blob, name)) return true;

  log.warn('no share route available', { kind: fileKind(name) });
  return false;
}

/** How a finished export should reach the user. */
export type Deliver = 'save' | 'share';

/**
 * What every export returns: the file name when the document reached the user,
 * and `null` when it did not.
 *
 * A cancelled save dialog is not a failure — nothing is thrown — so the caller
 * should fall silent rather than complain, and above all must not announce a
 * file that was never written.
 */
export type ExportResult = string | null;

/**
 * One call for both buttons.
 *
 * Sharing falls back to saving when no sheet can be opened, so the file is
 * never simply lost: the worst case is that it lands where "save" would have
 * put it, which is still in front of the user.
 *
 * False means it reached neither — cancelled, or nowhere to put it.
 */
export async function deliverBlob(
  blob: Blob,
  name: string,
  how: Deliver = 'save',
): Promise<boolean> {
  if (how === 'share' && (await shareBlob(blob, name))) return true;
  return saveBlob(blob, name);
}

export async function deliverBinary(
  bytes: Uint8Array,
  name: string,
  mime: string,
  how: Deliver = 'save',
): Promise<boolean> {
  return deliverBlob(new Blob([bytes as BlobPart], { type: mime }), name, how);
}

/**
 * True where `window.print()` does nothing.
 *
 * A web view has no print dialog, so on the iPhone and iPad app the print
 * button has to produce the PDF and hand it to the iOS share sheet — Print
 * lives there, alongside Save to Files.
 */
export function needsShareToPrint(): boolean {
  return isNativeApp() || (isIos() && !!navigator.canShare);
}
