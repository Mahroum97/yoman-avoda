/**
 * Signature capture for finger, Apple Pencil and mouse.
 *
 * Everything here is shaped by what actually goes wrong on a phone:
 *
 *  - **Listeners are attached natively, not through React props.** React
 *    registers `touchstart`/`touchmove` on the root as *passive*, so a
 *    `preventDefault()` inside `onTouchMove` is silently discarded. On iOS that
 *    lets WebKit decide the drag was a scroll, and it then fires `pointercancel`
 *    a few pixels in — which looks exactly like "the finger does not draw".
 *    `addEventListener(..., { passive: false })` is the only way to refuse.
 *  - **The stroke follows the window, not the canvas.** Tracking moves on the
 *    element means a fast stroke that strays over the edge stops dead, and
 *    `pointerleave` used to end it outright. Window listeners plus pointer
 *    capture keep a stroke alive until the finger is genuinely lifted.
 *  - **Palm rejection only arms itself once a pen has really been used**, and
 *    only on that device. A phone has no pencil, so it must never be able to
 *    reject a finger.
 *  - The canvas is sized from its laid-out box. If that box is still zero when
 *    the effect first runs — which happens inside a card that has just mounted
 *    on a phone — the canvas ends up 0×0 and strokes go nowhere. A
 *    ResizeObserver re-sizes it and the drawing is preserved across resizes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../i18n/useLanguage';
import { logger } from '../lib/log';
import { Icon } from './Icon';

const log = logger('sign');

/** Line width for a finger or mouse; a pen modulates around this. */
const BASE_WIDTH = 2.4;
const PEN_MIN = 1.1;
const PEN_MAX = 4.2;
/** How long after a real pen stroke a touch is still treated as palm. */
const PALM_WINDOW_MS = 900;

interface Point {
  x: number;
  y: number;
  width: number;
}

export function SignaturePad({
  label,
  value,
  onChange,
  saved,
}: {
  label: string;
  value: string;
  onChange: (dataUrl: string) => void;
  /** A signature kept in Settings, offered here so a page can be signed by tap. */
  saved?: string;
}) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const last = useRef<Point | null>(null);
  const activeId = useRef<number | null>(null);
  /** Set only when a pen has genuinely drawn on *this* device. */
  const penSeen = useRef(false);
  const lastPenAt = useRef(0);
  const usingPointer = useRef(false);
  /** Keeps the on-device log to the first stroke instead of every sample. */
  const traced = useRef(false);
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

  /* --------------------------------------------------------------- drawing */

  const pointFrom = useCallback(
    (clientX: number, clientY: number, pressure: number, isPen: boolean): Point | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      // A pen without real pressure reports 0 or exactly 0.5; treat those as a
      // normal stroke rather than an invisible hairline.
      const usable = isPen && pressure > 0 && pressure !== 0.5;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
        width: usable ? PEN_MIN + (PEN_MAX - PEN_MIN) * pressure : BASE_WIDTH,
      };
    },
    [],
  );

  const beginStroke = useCallback((point: Point | null) => {
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
  }, []);

  const extendStroke = useCallback((point: Point | null) => {
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
  }, []);

  const endStroke = useCallback(() => {
    drawing.current = false;
    last.current = null;
    activeId.current = null;
  }, []);

  /* ------------------------------------------------------- native listeners */

  useEffect(() => {
    if (!editing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const isPalm = (type: string) =>
      type === 'touch' && penSeen.current && Date.now() - lastPenAt.current < PALM_WINDOW_MS;

    /* ---- pointer events: the primary path, and the only one with pressure */

    const onPointerDown = (event: PointerEvent) => {
      usingPointer.current = true;
      if (isPalm(event.pointerType)) return;
      if (event.pointerType === 'pen') {
        penSeen.current = true;
        lastPenAt.current = Date.now();
      }
      event.preventDefault();

      if (!traced.current) {
        traced.current = true;
        const rect = canvas.getBoundingClientRect();
        log.debug('first stroke', {
          pointerType: event.pointerType,
          canvas: `${canvas.width}x${canvas.height}`,
          box: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          ratio: window.devicePixelRatio,
        });
      }

      activeId.current = event.pointerId;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Not available in every web view; the window listeners cover it.
      }
      beginStroke(
        pointFrom(event.clientX, event.clientY, event.pressure, event.pointerType === 'pen'),
      );
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drawing.current) return;
      if (activeId.current !== null && event.pointerId !== activeId.current) return;
      if (isPalm(event.pointerType)) return;
      if (event.pointerType === 'pen') lastPenAt.current = Date.now();
      event.preventDefault();

      // Coalesced events keep a fast pencil stroke smooth instead of angular.
      const batch =
        typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
      for (const raw of batch.length ? batch : [event]) {
        extendStroke(
          pointFrom(raw.clientX, raw.clientY, raw.pressure, raw.pointerType === 'pen'),
        );
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (activeId.current !== null && event.pointerId !== activeId.current) return;
      endStroke();
    };

    const onPointerCancel = (event: PointerEvent) => {
      // Worth recording: if iOS is taking the gesture away mid-stroke, this is
      // the line that says so, and nothing else would.
      if (drawing.current) log.warn('stroke cancelled by the browser', { type: event.pointerType });
      endStroke();
    };

    /* ---- touch events: for web views where pointer events never arrive */

    const onTouchStart = (event: TouchEvent) => {
      if (usingPointer.current) return;
      event.preventDefault();
      const touch = event.touches[0];
      if (touch) beginStroke(pointFrom(touch.clientX, touch.clientY, 0, false));
    };

    const onTouchMove = (event: TouchEvent) => {
      if (usingPointer.current) return;
      event.preventDefault();
      const touch = event.touches[0];
      if (touch) extendStroke(pointFrom(touch.clientX, touch.clientY, 0, false));
    };

    // `passive: false` is the whole point: it is what lets preventDefault stop
    // iOS from reinterpreting the stroke as a scroll.
    const opts = { passive: false } as const;
    canvas.addEventListener('pointerdown', onPointerDown, opts);
    window.addEventListener('pointermove', onPointerMove, opts);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('touchstart', onTouchStart, opts);
    canvas.addEventListener('touchmove', onTouchMove, opts);
    window.addEventListener('touchend', endStroke);
    window.addEventListener('touchcancel', endStroke);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', endStroke);
      window.removeEventListener('touchcancel', endStroke);
    };
  }, [editing, beginStroke, extendStroke, endStroke, pointFrom]);

  /* --------------------------------------------------------------- actions */

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
      <canvas ref={canvasRef} className="sign__canvas" aria-label={label} />
      <div className="sign__bar">
        <span className="grow">{t.signHere(label)}</span>
        {saved && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              onChange(saved);
              setEditing(false);
            }}
          >
            <Icon name="check" size={16} strokeWidth={2.4} />
            {t.signatureUseSaved}
          </button>
        )}
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
