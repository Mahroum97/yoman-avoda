/**
 * Finger/stylus/mouse signature capture.
 *
 * Draws at devicePixelRatio so the exported PNG is crisp in Word, and keeps the
 * saved signature as a PNG data URL — small enough to live inside the entry
 * record and to embed directly with docx's ImageRun.
 */
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../i18n/useLanguage';

const STROKE_WIDTH = 2.4;

export function SignaturePad({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (dataUrl: string) => void;
}) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [editing, setEditing] = useState(!value);

  // Size the backing store to the element's real pixel size.
  useEffect(() => {
    if (!editing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = '#101418';
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    dirty.current = false;
  }, [editing]);

  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = pointAt(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pointAt(event);
    ctx.lineTo(x, y);
    ctx.stroke();
    dirty.current = true;
  };

  const end = () => {
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    dirty.current = false;
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!dirty.current) {
      onChange('');
      setEditing(false);
      return;
    }
    onChange(canvas.toDataURL('image/png'));
    setEditing(false);
  };

  if (!editing && value) {
    return (
      <div className="sign">
        <img className="sign__preview" src={value} alt={label} />
        <div className="sign__bar">
          <span className="grow">{t.signed(label)}</span>
          <button type="button" className="btn btn--sm" onClick={() => setEditing(true)}>
            {t.signAgain}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            onClick={() => {
              onChange('');
              setEditing(true);
            }}
          >
            {t.delete}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sign">
      <canvas
        ref={canvasRef}
        className="sign__canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
        aria-label={label}
      />
      <div className="sign__bar">
        <span className="grow">{t.signHere(label)}</span>
        <button type="button" className="btn btn--sm" onClick={clear}>
          {t.clear}
        </button>
        <button type="button" className="btn btn--sm btn--primary" onClick={save}>
          {t.saveSignature}
        </button>
      </div>
    </div>
  );
}
