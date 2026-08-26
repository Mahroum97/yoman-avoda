/**
 * A photograph's bytes — and why a photograph is bytes and not a Blob.
 *
 * Photos used to be stored as `Blob`s inside the entry record, which is the
 * obvious thing to do and is how this app kept them for its first month. A Blob
 * in IndexedDB is not stored in the record: the browser writes the body to a
 * file of its own beside the database and keeps a reference to it. On iOS that
 * reference is fragile in a way nothing warns about — **installing a new build
 * of the app breaks it**. The entries survive with their captions, their sizes
 * and their dimensions; every picture in them is gone, and the page comes back
 * as a grid of broken squares that still exports as a diary page with nothing
 * on it. That is the fault this file exists to make impossible: it happened
 * here, to a day with ten photographs of a stairwell in it, and there was
 * nothing to recover from.
 *
 * `Uint8Array` is structured-cloned into the record itself. It travels with the
 * page, into the backup, over the sync, and through an app reinstall.
 *
 * Records written before this still carry `blob`, so both are read; only
 * `bytes` is ever written. `saveEntry` converts what it is given, so a page
 * migrates the first time it is saved on a device that can still read it.
 */
import type { Photo } from '../types';

/** The bytes, whichever form the photo is in, or null if they cannot be read. */
export async function photoBytes(photo: Photo): Promise<Uint8Array | null> {
  if (photo.bytes && photo.bytes.byteLength > 0) return photo.bytes;
  if (photo.blob) {
    try {
      const buffer = await photo.blob.arrayBuffer();
      if (buffer.byteLength > 0) return new Uint8Array(buffer);
    } catch {
      // The file the Blob pointed at is no longer there. Nothing to do here;
      // the callers draw or report the gap rather than pretending.
    }
  }
  return null;
}

/** What the photo weighs, without reading it. */
export const photoSize = (photo: Photo): number =>
  photo.bytes?.byteLength ?? photo.blob?.size ?? 0;

/**
 * A Blob to show, built from the bytes so it is held in memory.
 *
 * An object URL made from a Blob that came out of IndexedDB is the other half
 * of the same iOS fault: it fails to load in an `<img>` after the app has been
 * closed and reopened, even while the bytes are still readable.
 */
export function photoBlob(photo: Photo, type = 'image/jpeg'): Blob | null {
  if (photo.bytes && photo.bytes.byteLength > 0) {
    return new Blob([photo.bytes as BlobPart], { type });
  }
  return photo.blob ?? null;
}

/**
 * The form a photo is stored in.
 *
 * A photo whose bytes cannot be read is left exactly as it is rather than
 * dropped: the record is all that is left of it, and the caption and the date
 * are worth keeping even when the picture is not there.
 */
export async function storablePhoto(photo: Photo): Promise<Photo> {
  if (photo.bytes && photo.bytes.byteLength > 0) {
    return photo.blob ? { ...photo, blob: undefined } : photo;
  }
  const bytes = await photoBytes(photo);
  return bytes ? { ...photo, bytes, blob: undefined } : photo;
}

export function storablePhotos(photos: Photo[]): Promise<Photo[]> {
  return Promise.all(photos.map(storablePhoto));
}

/**
 * Base64 without `FileReader`, for the backup and the wire.
 *
 * Chunked, because `String.fromCharCode(...bytes)` on a whole photograph is a
 * call with half a million arguments and the stack gives out.
 */
export function bytesToDataUrl(bytes: Uint8Array, type = 'image/jpeg'): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return new Uint8Array();
  const body = dataUrl.slice(comma + 1);
  if (!dataUrl.slice(0, comma).includes(';base64')) {
    return new TextEncoder().encode(decodeURIComponent(body));
  }
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* -------------------------------------------------- the one-time conversion */

/** Set once every page has been through `rewritePhotosAsBytes`. */
const CONVERTED_KEY = 'yoman-photos-bytes';

/**
 * Rewrites every page that still stores its photographs as Blobs.
 *
 * Converting on save alone was not enough: a page nobody opens keeps its Blobs,
 * and the next time a new build of the app is installed on the phone they are
 * the ones that break. This walks the diary once, on the first launch after the
 * change, and it is worth the seconds it costs — after it, no picture in the
 * diary depends on a file the operating system may take away.
 *
 * `updatedAt` is deliberately left alone. The bytes are the same photograph in
 * a different wrapper, not an edit, and stamping every page would send the
 * whole diary over the next sync and win every conflict on the other device
 * with pages the user never touched.
 *
 * Runs one page at a time — a diary is megabytes of photographs and holding it
 * all at once is how a phone kills the tab — and never throws: a page whose
 * bytes cannot be read is left exactly as it is, for the export to report.
 */
export async function rewritePhotosAsBytes(): Promise<{ pages: number; lost: number }> {
  const result = { pages: 0, lost: 0 };
  try {
    if (localStorage.getItem(CONVERTED_KEY)) return result;
  } catch {
    // No storage for the flag: the walk below is safe to repeat.
  }

  const { db } = await import('../db');
  const { logger } = await import('./log');
  const log = logger('photos');

  try {
    const ids = (await db.entries.toCollection().primaryKeys()) as number[];
    for (const id of ids) {
      const entry = await db.entries.get(id);
      if (!entry?.photos?.some((photo) => photo.blob)) continue;

      const photos = await storablePhotos(entry.photos);
      const lost = photos.filter((photo) => !photo.bytes && photo.blob).length;
      await db.entries.put({ ...entry, photos });
      result.pages += 1;
      result.lost += lost;
    }
    try {
      localStorage.setItem(CONVERTED_KEY, String(Date.now()));
    } catch {
      // Then it runs again next time, which costs a walk and breaks nothing.
    }
    if (result.pages > 0) log.info('photos rewritten as bytes', result);
  } catch (error) {
    log.warn('rewriting photos as bytes failed', error);
  }
  return result;
}
