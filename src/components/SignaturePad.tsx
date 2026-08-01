/**
 * Signature capture for finger, Apple Pencil and mouse.
 *
 * Things that made this harder than it looks, all of which are load-bearing:
 *
 *  - The canvas is sized from its laid-out box. If that box is still zero when
 *    the effect first runs — which happens inside a card that has just mounted
 *    on a phone — the canvas ends up 0×0 and strokes go nowhere. A
 *    ResizeObserver re-sizes it, and the drawing is preserved across resizes.
 *  - `setPointerCapture` can throw on iOS; a signature must not depend on it.
 *  - Touch events are handled as a fallback for web views where pointer events
 *    arrive late or not at all, with a guard so a stroke is never drawn twice.
 *  - A pencil resting a palm on the screen fires touch pointers as well. Once a
 *    pen has been seen, touch input is ignored — that is palm rejection.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../i18n/useLanguage';

/** Line width for a finger or mouse; a pen modulates around this. */
const BASE_WIDTH = 2.4;
const PEN_MIN = 1.1;
const PEN_MAX = 4.2;
/** How long after a pen stroke touches are still treated as palm. */
const PALM_WINDOW_MS = 1500;

interface Point {
  x: number;
  y: number;
  width: number;
}

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
  const last = useRef<Point | null>(null);
  const lastPenAt = useRef(0);
  const usingPointer = useRef(false);
  const [editing, setEditing] = useState(!value);

  const context = () => canvasRef.current?.getContext('2d') ?? null;

  const prime = (ctx: CanvasRenderingContext2D) => {
    ctx.strokeStyle = '#101418';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  /** Sizes the backing store to the element, keeping whatever was drawn. */
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);
    if (canvas.width === width && canvas.height === height) return;

    const previous = dirty.current ? canvas.toDataURL('image/png') : null;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    prime(ctx);

    if (previous) {
      const image = new Image();
      image.onload = () => ctx.drawImage(image, 0, 0, rect.width, rect.height);
      image.src = previous;
    }
  }, []);

  useEffect(() => {
    if (!editing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    dirty.current = false;
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [editing, resize]);

  /* ------------------------------------------------------------- drawing */

  const pointFrom = (
    clientX: number,
    clientY: number,
    pressure: number,
    isPen: boolean,
  ): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    // A pen without real pressure reports 0 or 0.5; treat those as a normal
    // stroke rather than an invisible hairline.
    const usable = isPen && pressure > 0 && pressure !== 0.5;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      width: usable ? PEN_MIN + (PEN_MAX - PEN_MIN) * pressure : BASE_WIDTH,
    };
  };

  const beginStroke = (point: Point | null) => {
    if (!point) return;
    const ctx = context();
    if (!ctx) return;
    prime(ctx);
    drawing.current = true;
    last.current = point;
    // A tap with no movement should still leave a mark.
    ctx.beginPath();
    ctx.lineWidth = point.width;
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + 0.01, point.y);
    ctx.stroke();
    dirty.current = true;
  };

  const extendStroke = (point: Point | null) => {
    if (!drawing.current || !point) return;
    const ctx = context();
    const from = last.current;
    if (!ctx || !from) return;
    ctx.beginPath();
    ctx.lineWidth = point.width;
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    last.current = point;
    dirty.current = true;
  };

  const endStroke = () => {
    drawing.current = false;
    last.current = null;
  };

  /* ------------------------------------------------------ pointer events */

  const isPalm = (type: string) =>
    type === 'touch' && Date.now() - lastPenAt.current < PALM_WINDOW_MS;

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    usingPointer.current = true;
    if (isPalm(event.pointerType)) return;
    if (event.pointerType === 'pen') lastPenAt.current = Date.now();
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Not available in every web view; the window listeners below cover it.
    }
    beginStroke(
      pointFrom(event.clientX, event.clientY, event.pressure, event.pointerType === 'pen'),
    );
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || isPalm(event.pointerType)) return;
    if (event.pointerType === 'pen') lastPenAt.current = Date.now();
    event.preventDefault();

    // Coalesced events keep a fast pencil stroke smooth instead of angular.
    const events =
      typeof event.nativeEvent.getCoalescedEvents === 'function'
        ? event.nativeEvent.getCoalescedEvents()
        : [event.nativeEvent];
    for (const raw of events.length ? events : [event.nativeEvent]) {
      extendStroke(pointFrom(raw.clientX, raw.clientY, raw.pressure, raw.pointerType === 'pen'));
    }
  };

  /* -------------------------------------------------------- touch events */

  const onTouchStart = (event: React.TouchEvent<HTMLCanvasElement>) => {
    // Pointer events already handled it; doing both would double the stroke.
    if (usingPointer.current) return;
    event.preventDefault();
    const touch = event.touches[0];
    if (touch) beginStroke(pointFrom(touch.clientX, touch.clientY, 0, false));
  };

  const onTouchMove = (event: React.TouchEvent<HTMLCanvasElement>) => {
    if (usingPointer.current) return;
    event.preventDefault();
    const touch = event.touches[0];
    if (touch) extendStroke(pointFrom(touch.clientX, touch.clientY, 0, false));
  };

  /* -------------------------------------------------------------- actions */

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    prime(ctx);
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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onPointerLeave={endStroke}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={endStroke}
        onTouchCancel={endStroke}
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
