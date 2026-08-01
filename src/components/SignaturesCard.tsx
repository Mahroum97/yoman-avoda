/**
 * Saved signatures, in Settings.
 *
 * Two slots — the site manager's and the supervisor's — each fillable either by
 * drawing it once or by uploading a photograph of a signature on paper. From
 * then on a diary page is signed with one tap instead of a fingertip drawing on
 * a phone, which is the part people actually complain about.
 */
import { useState } from 'react';
import {
  clearSavedSignature,
  saveDrawnSignature,
  saveSignatureImage,
  useSavedSignature,
  type SignatureRole,
} from '../hooks/useSignatures';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { logger } from '../lib/log';
import { Card } from './ui';
import { SignaturePad } from './SignaturePad';

const log = logger('signatures');

function Slot({ role, label }: { role: SignatureRole; label: string }) {
  const { t } = useLanguage();
  const toast = useToast();
  const saved = useSavedSignature(role);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      await saveSignatureImage(role, file);
      log.info('signature image saved', { role, bytes: file.size });
      toast.show(t.signatureSaved);
    } catch (error) {
      log.error('signature image failed', error);
      toast.error(t.signatureFailed);
    } finally {
      setBusy(false);
    }
  }

  if (drawing) {
    return (
      <div className="sig-slot">
        <div className="sig-slot__label">{label}</div>
        <SignaturePad
          label={label}
          value=""
          onChange={(dataUrl) => {
            void (async () => {
              await saveDrawnSignature(role, dataUrl);
              setDrawing(false);
              if (dataUrl) toast.show(t.signatureSaved);
            })();
          }}
        />
        <div className="btn-row">
          <button type="button" className="btn btn--sm" onClick={() => setDrawing(false)}>
            {t.cancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sig-slot">
      <div className="sig-slot__label">{label}</div>

      {saved ? (
        <img className="sig-slot__preview" src={saved} alt={label} />
      ) : (
        <div className="sig-slot__empty">{t.signatureEmpty}</div>
      )}

      <div className="btn-row">
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => setDrawing(true)}>
          ✍ {saved ? t.signatureRedraw : t.signatureDraw}
        </button>

        <label className={`btn btn--sm${busy ? ' btn--disabled' : ''}`}>
          🖼 {t.signatureUpload}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void upload(file);
            }}
          />
        </label>

        {saved && (
          <button
            type="button"
            className="btn btn--sm btn--danger"
            disabled={busy}
            onClick={() => {
              void clearSavedSignature(role);
              toast.show(t.signatureRemoved);
            }}
          >
            {t.delete}
          </button>
        )}
      </div>
    </div>
  );
}

export function SignaturesCard() {
  const { t } = useLanguage();
  return (
    <Card title={t.signaturesTitle} note={t.signaturesHint}>
      <div className="stack">
        <Slot role="manager" label={t.labelManagerSignature} />
        <Slot role="supervisor" label={t.labelSupervisorSignature} />
      </div>
      <p className="card__note" style={{ marginTop: 12 }}>
        {t.signatureUploadHint}
      </p>
    </Card>
  );
}
