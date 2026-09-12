/**
 * Site photos for one diary page. The URLs behind the thumbnails come from
 * `usePhotoUrls`, which is where the rules about them live.
 */
import { useRef, useState } from 'react';
import type { Photo } from '../types';
import { formatBytes, prepareImage } from '../lib/images';
import { photoSize } from '../lib/photoData';
import { uid } from '../lib/id';
import { usePhotoUrls } from '../hooks/usePhotoUrls';
import { useLanguage } from '../i18n/useLanguage';
import { Icon } from './Icon';

export function PhotoGrid({
  photos,
  onChange,
  onError,
}: {
  photos: Photo[];
  onChange: (photos: Photo[]) => void;
  onError: (message: string) => void;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const latest = useRef(photos);
  latest.current = photos;
  const { urls, retry } = usePhotoUrls(photos);

  // Update the ref in the same event as the parent callback. Image preparation
  // is asynchronous, so another edit can otherwise happen before props return.
  const change = (next: Photo[]) => {
    latest.current = next;
    onChange(next);
  };

  /**
   * Each picked file is prepared on its own.
   *
   * One loop in one `try` meant one file the phone could not decode — a video
   * picked by accident, a format the web view does not read — threw out every
   * other photo picked with it. Fifteen chosen, an error shown, nothing added,
   * and no way to tell which one it was. Now what worked is kept, and the
   * message says how many did not.
   */
  const add = async (files: FileList | null) => {
    if (!files?.length || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const added: Photo[] = [];
      let failed = 0;
      for (const file of Array.from(files)) {
        try {
          const { blob, width, height } = await prepareImage(file);
          added.push({
            id: uid(),
            caption: '',
            // Bytes from the first moment, never a Blob — see photoData.ts.
            bytes: new Uint8Array(await blob.arrayBuffer()),
            width,
            height,
            takenAt: file instanceof File ? file.lastModified : Date.now(),
          });
        } catch {
          failed += 1;
        }
      }
      // Merge into what exists *now*, after preparation, rather than the props
      // captured when the picker opened. Captions, removals and another batch
      // completed during that wait must all survive.
      if (added.length > 0) change([...latest.current, ...added]);
      if (failed > 0) onError(t.photosSkipped(failed));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const totalBytes = photos.reduce((sum, photo) => sum + photoSize(photo), 0);

  return (
    <div className="stack">
      <div className="row row--wrap">
        <label className="btn btn--primary">
          {busy ? (
            t.loading
          ) : (
            <>
              <Icon name="image" size={17} />
              {t.addPhotos}
            </>
          )}
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        {/* A second entry point that opens the camera straight away on a phone. */}
        <label className="btn">
          <Icon name="camera" size={17} />
          {t.takePhoto}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        {photos.length > 0 && (
          <span className="muted small">
            {t.photosSummary(photos.length, formatBytes(totalBytes))}
          </span>
        )}
      </div>

      {photos.length > 0 && (
        <div className="photos">
          {photos.map((photo, index) => (
            <figure className="photo" key={photo.id} style={{ margin: 0 }}>
              <img
                src={urls[photo.id]}
                alt={photo.caption || t.photoNumber(index + 1)}
                onError={() => retry(photo.id)}
              />
              <div className="photo__bar">
                <input
                  type="text"
                  value={photo.caption}
                  placeholder={t.phCaption}
                  onChange={(e) =>
                    change(
                      latest.current.map((p) =>
                        p.id === photo.id ? { ...p, caption: e.target.value } : p,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="btn btn--sm btn--danger"
                  aria-label={t.deletePhoto}
                  onClick={() => change(latest.current.filter((p) => p.id !== photo.id))}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
