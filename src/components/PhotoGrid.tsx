/**
 * Site photos for one diary page. Object URLs are created per photo and revoked
 * when the set changes, so a long editing session does not leak blobs.
 */
import { useEffect, useState } from 'react';
import type { Photo } from '../types';
import { formatBytes, prepareImage } from '../lib/images';
import { uid } from '../lib/id';
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
  const [urls, setUrls] = useState<Record<string, string>>({});

  // Create and revoke inside the same effect: a URL made in a render-phase memo
  // can outlive the cleanup that revokes it, leaving broken <img> elements.
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const photo of photos) map[photo.id] = URL.createObjectURL(photo.blob);
    setUrls(map);
    return () => {
      for (const url of Object.values(map)) URL.revokeObjectURL(url);
    };
  }, [photos]);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const added: Photo[] = [];
      for (const file of Array.from(files)) {
        const { blob, width, height } = await prepareImage(file);
        added.push({
          id: uid(),
          caption: '',
          blob,
          width,
          height,
          takenAt: file instanceof File ? file.lastModified : Date.now(),
        });
      }
      onChange([...photos, ...added]);
    } catch {
      onError(t.photoLoadFailed);
    } finally {
      setBusy(false);
    }
  };

  const totalBytes = photos.reduce((sum, photo) => sum + photo.blob.size, 0);

  return (
    <div className="stack">
      <div className="row row--wrap">
        <label className="btn btn--primary">
          {busy ? t.loading : `📷 ${t.addPhotos}`}
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        {/* A second entry point that opens the camera straight away on a phone. */}
        <label className="btn">
          📸 {t.takePhoto}
          <input
            type="file"
            accept="image/*"
            capture="environment"
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
              <img src={urls[photo.id]} alt={photo.caption || t.photoNumber(index + 1)} />
              <div className="photo__bar">
                <input
                  type="text"
                  value={photo.caption}
                  placeholder={t.phCaption}
                  onChange={(e) =>
                    onChange(
                      photos.map((p) =>
                        p.id === photo.id ? { ...p, caption: e.target.value } : p,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="btn btn--sm btn--danger"
                  aria-label={t.deletePhoto}
                  onClick={() => onChange(photos.filter((p) => p.id !== photo.id))}
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
