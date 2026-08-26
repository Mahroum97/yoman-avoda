/**
 * Object URLs for stored photos, keyed by photo id.
 *
 * A photo lives in IndexedDB as a Blob, and `URL.createObjectURL(blob)` is the
 * obvious way to show one. It is also where a day's photographs go to disappear.
 *
 * - **A Blob read back from IndexedDB is backed by a file, not by memory.** On
 *   iOS — the native app and Safari both — the URL minted for such a Blob after
 *   the app has been closed and reopened often fails to load in an `<img>`: the
 *   page comes back showing every photo as a broken square, while the very same
 *   photos still export into the PDF, because building the document reads the
 *   bytes instead of handing the tag a URL. Reading the bytes and wrapping them
 *   in a fresh in-memory Blob is what makes the URL load. That copy costs
 *   memory, so it is taken up front only where the fault lives, and everywhere
 *   else only after an image has actually failed.
 * - **A URL survives an edit.** Typing a caption rebuilds the photos array, and
 *   an effect keyed on that array revoked every URL and minted new ones on each
 *   keystroke — the pictures blinking out and back on a phone while the caption
 *   was being typed. The identity that matters is the set of photo ids.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Photo } from '../types';
import { isIos } from '../lib/save';
import { logger } from '../lib/log';

const log = logger('photos');

/** The bytes, re-wrapped so the URL is served from memory rather than a file. */
async function memoryUrl(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  return URL.createObjectURL(new Blob([bytes], { type: blob.type || 'image/jpeg' }));
}

export interface PhotoUrls {
  /** Photo id -> a URL an `<img>` can load, once it is ready. */
  urls: Record<string, string>;
  /**
   * Hand this to the image's `onError`. It re-reads that one photo from its
   * bytes and swaps the URL, which is the repair for a Blob whose file the web
   * view will not open.
   */
  retry: (id: string) => void;
}

export function usePhotoUrls(photos: Photo[]): PhotoUrls {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Revoking is the owner's job, and the owner is this hook: everything it has
  // minted is dropped on unmount, whatever route it was minted by.
  const minted = useRef<Record<string, string>>({});
  const blobs = useRef<Record<string, Blob>>({});
  const retried = useRef<Set<string>>(new Set());

  blobs.current = Object.fromEntries(photos.map((photo) => [photo.id, photo.blob]));

  const ids = photos.map((photo) => photo.id).join(',');

  useEffect(() => {
    let cancelled = false;
    const own = blobs.current;
    const made: Record<string, string> = {};

    const publish = () => {
      if (cancelled) {
        for (const url of Object.values(made)) URL.revokeObjectURL(url);
        return;
      }
      minted.current = made;
      retried.current = new Set();
      setUrls({ ...made });
    };

    if (!isIos()) {
      for (const [id, blob] of Object.entries(own)) made[id] = URL.createObjectURL(blob);
      publish();
    } else {
      void (async () => {
        for (const [id, blob] of Object.entries(own)) {
          try {
            made[id] = await memoryUrl(blob);
          } catch (error) {
            log.warn('photo could not be read', error);
          }
          if (cancelled) break;
        }
        publish();
      })();
    }

    return () => {
      cancelled = true;
      for (const url of Object.values(made)) URL.revokeObjectURL(url);
    };
    // Keyed on the ids: a caption edit hands back a new array of the same
    // photos, and rebuilding every URL for it is what made them blink.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const retry = useCallback((id: string) => {
    // Once per photo per set. A URL that fails again after being re-read is a
    // photo that cannot be shown, and re-reading it in a loop would only pin
    // the phone to the fault.
    if (retried.current.has(id)) return;
    retried.current.add(id);
    const blob = blobs.current[id];
    if (!blob) return;

    void (async () => {
      try {
        const fresh = await memoryUrl(blob);
        const stale = minted.current[id];
        minted.current = { ...minted.current, [id]: fresh };
        setUrls((current) => ({ ...current, [id]: fresh }));
        if (stale) URL.revokeObjectURL(stale);
        log.info('photo re-read after it would not display');
      } catch (error) {
        log.warn('photo could not be re-read', error);
      }
    })();
  }, []);

  return { urls, retry };
}
