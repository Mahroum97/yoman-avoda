/**
 * Object URLs for stored photos, keyed by photo id.
 *
 * Photographs are stored as bytes (`src/lib/photoData.ts` says why), so the URL
 * is minted from a Blob built in memory here. That is the half of the iOS fault
 * this hook exists for: an object URL made from a Blob that came *out of*
 * IndexedDB often will not load in an `<img>` once the app has been closed and
 * reopened, and the day comes back as a grid of broken squares. A photo still
 * stored the old way is read once and treated the same.
 *
 * The other rule here is that a URL outlives an edit. Typing a caption rebuilds
 * the photos array, and an effect keyed on that array revoked every URL and
 * minted new ones on each keystroke — the pictures blinking out and back on a
 * phone while the caption was being typed. The identity that matters is the set
 * of photo ids.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Photo } from '../types';
import { photoBlob, photoBytes } from '../lib/photoData';
import { logger } from '../lib/log';

const log = logger('photos');

/** A URL served from memory, or null when the photo's bytes are not there. */
async function memoryUrl(photo: Photo): Promise<string | null> {
  const direct = photo.bytes && photo.bytes.byteLength > 0 ? photoBlob(photo) : null;
  if (direct) return URL.createObjectURL(direct);
  const bytes = await photoBytes(photo);
  return bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' })) : null;
}

export interface PhotoUrls {
  /** Photo id -> a URL an `<img>` can load. */
  urls: Record<string, string>;
  /**
   * Hand this to the image's `onError`. It builds that one photo's URL again
   * from its bytes, which is the repair for a URL the web view will not open.
   */
  retry: (id: string) => void;
}

export function usePhotoUrls(photos: Photo[]): PhotoUrls {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Revoking is the owner's job, and the owner is this hook: everything it has
  // minted is dropped on unmount, whatever route it was minted by.
  const minted = useRef<Record<string, string>>({});
  const items = useRef<Record<string, Photo>>({});
  const retried = useRef<Set<string>>(new Set());

  items.current = Object.fromEntries(photos.map((photo) => [photo.id, photo]));

  const ids = photos.map((photo) => photo.id).join(',');

  useEffect(() => {
    let cancelled = false;
    const own = items.current;
    const made: Record<string, string> = {};
    const drop = () => {
      for (const url of Object.values(made)) URL.revokeObjectURL(url);
    };

    const publish = () => {
      if (cancelled) {
        drop();
        return;
      }
      minted.current = made;
      retried.current = new Set();
      setUrls({ ...made });
    };

    // Bytes need no reading, so the common case paints on the first render
    // rather than a frame later.
    const legacy: [string, Photo][] = [];
    for (const [id, photo] of Object.entries(own)) {
      const blob = photo.bytes && photo.bytes.byteLength > 0 ? photoBlob(photo) : null;
      if (blob) made[id] = URL.createObjectURL(blob);
      else legacy.push([id, photo]);
    }

    if (legacy.length === 0) {
      publish();
    } else {
      void (async () => {
        for (const [id, photo] of legacy) {
          try {
            const url = await memoryUrl(photo);
            if (url) made[id] = url;
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
      drop();
    };
    // Keyed on the ids: a caption edit hands back a new array of the same
    // photos, and rebuilding every URL for it is what made them blink.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const retry = useCallback((id: string) => {
    // Once per photo per set. A URL that fails again after being built afresh
    // is a photo that cannot be shown, and rebuilding it in a loop would only
    // pin the phone to the fault.
    if (retried.current.has(id)) return;
    retried.current.add(id);
    const photo = items.current[id];
    if (!photo) return;

    void (async () => {
      try {
        const fresh = await memoryUrl(photo);
        if (!fresh) return;
        const stale = minted.current[id];
        minted.current = { ...minted.current, [id]: fresh };
        setUrls((current) => ({ ...current, [id]: fresh }));
        if (stale) URL.revokeObjectURL(stale);
        log.info('photo url rebuilt after it would not display');
      } catch (error) {
        log.warn('photo could not be rebuilt', error);
      }
    })();
  }, []);

  return { urls, retry };
}
