/**
 * A list row that can be swiped sideways to act on it.
 *
 * Pointer events rather than touch events, for two reasons. The app is used on
 * a phone, an iPad and a Mac from one codebase, and pointer events cover a
 * finger, an Apple Pencil and a mouse without three sets of handlers. More
 * importantly, React attaches `touchstart`/`touchmove` at the root as *passive*
 * listeners, so calling `preventDefault` in a React touch handler does nothing
 * at all — the same trap that made the signature pad need native listeners. A
 * pointer gesture paired with `touch-action: pan-y` in the stylesheet needs no
 * `preventDefault`: the browser keeps vertical scrolling and hands us the
 * horizontal movement, which is exactly the division of labour we want.
 *
 * Directions are logical, like everything else here. The `start` action sits at
 * the inline-start edge and is uncovered by dragging the row toward the inline
 * end; `end` is its mirror. In Hebrew and Arabic that flips with the layout,
 * and it follows the platform convention either way — the destructive action
 * lands on the same side as it does in Mail.
 *
 * Releasing past the threshold performs the action immediately. There is no
 * half-open state to tidy up, and no confirmation dialog: what makes that safe
 * is that the caller offers an undo, not that the gesture is hard to complete.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useLanguage } from '../i18n/useLanguage';

export interface SwipeAction {
  label: string;
  icon: string;
  tone: 'pin' | 'danger';
  run: () => void;
}

/** How far the row must travel before letting go performs the action. */
const ACTION_AT = 84;
/** Past this the row stops following the finger one-to-one. */
const MAX_TRAVEL = 128;
/** Below this nothing has been decided yet — it could still be a tap. */
const SLOP = 10;

type Mode = 'idle' | 'deciding' | 'swiping' | 'scrolling';

export function SwipeRow({
  start,
  end,
  disabled = false,
  children,
}: {
  start?: SwipeAction;
  end?: SwipeAction;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const toEnd = t.dir === 'rtl' ? -1 : 1;

  const [travel, setTravel] = useState(0);
  const [dragging, setDragging] = useState(false);

  const from = useRef({ x: 0, y: 0 });
  const mode = useRef<Mode>('idle');
  /**
   * Which pointer owns the gesture in progress.
   *
   * Without this a row could be left armed — `pointercancel` is not guaranteed
   * to arrive, and iOS drops it when a gesture races the scroller — and then
   * the *next* plain tap on that row would be read as the end of the abandoned
   * swipe and run its action. A tap silently deleting a day's page is the worst
   * thing this component could do, so an up is only honoured when it belongs to
   * the pointer that started the swipe.
   */
  const owner = useRef<number | null>(null);
  // A swipe ends with a `click` on whatever was under the finger, which would
  // open the very page just acted on. Set on release, read by the capture-phase
  // handler that fires immediately afterwards.
  const swallowClick = useRef(false);

  const reset = () => {
    mode.current = 'idle';
    owner.current = null;
    setDragging(false);
    setTravel(0);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Any gesture still hanging around belongs to a pointer that is gone.
    reset();
    if (disabled || (!start && !end)) return;
    // A secondary mouse button is a context menu, not a swipe.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    from.current = { x: event.clientX, y: event.clientY };
    mode.current = 'deciding';
    owner.current = event.pointerId;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== owner.current) return;
    if (mode.current === 'idle' || mode.current === 'scrolling') return;

    const dx = event.clientX - from.current.x;
    const dy = event.clientY - from.current.y;

    if (mode.current === 'deciding') {
      // Whichever axis crosses the slop first wins the gesture. Vertical means
      // the list is being scrolled and this row must keep out of the way for
      // the rest of the touch.
      if (Math.abs(dy) > SLOP && Math.abs(dy) >= Math.abs(dx)) {
        mode.current = 'scrolling';
        return;
      }
      if (Math.abs(dx) <= SLOP) return;
      mode.current = 'swiping';
      setDragging(true);
      // Keeps the moves coming even when the finger leaves the row, which it
      // does on any swipe long enough to matter. It throws if the pointer is
      // already gone, and an exception here would abandon the gesture with the
      // row left hanging open — the capture is an improvement, not a
      // requirement, so losing it must not cost the swipe.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* no capture; the row still follows while the pointer is over it */
      }
    }

    // Logical from here on: positive is toward the inline end, whatever the
    // language does to the layout.
    let logical = dx * toEnd;
    if ((logical > 0 && !start) || (logical < 0 && !end)) logical = 0;

    const size = Math.abs(logical);
    const capped = size <= MAX_TRAVEL ? size : MAX_TRAVEL + (size - MAX_TRAVEL) * 0.22;
    setTravel(Math.sign(logical) * capped);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== owner.current) return;
    const swiping = mode.current === 'swiping';
    const action = travel > 0 ? start : end;
    const armed = swiping && Math.abs(travel) >= ACTION_AT && action;
    if (swiping) swallowClick.current = true;
    reset();
    if (armed) action.run();
  };

  const panel = (action: SwipeAction | undefined, side: 'start' | 'end') => {
    if (!action) return null;
    const size = side === 'start' ? Math.max(travel, 0) : Math.max(-travel, 0);
    if (size <= 0) return null;
    return (
      <div
        className={[
          'swipe__action',
          `swipe__action--${side}`,
          `swipe__action--${action.tone}`,
          size >= ACTION_AT ? 'swipe__action--armed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ inlineSize: size }}
        aria-hidden="true"
      >
        <span className="swipe__icon">{action.icon}</span>
        <span className="swipe__label">{action.label}</span>
      </div>
    );
  };

  return (
    <div
      className="swipe"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      // A cancel is the browser taking the gesture away — never an action.
      onPointerCancel={(event) => {
        if (event.pointerId === owner.current) reset();
      }}
      onClickCapture={(event) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {panel(start, 'start')}
      {panel(end, 'end')}
      <div
        className={`swipe__content${dragging ? ' swipe__content--dragging' : ''}`}
        style={travel === 0 ? undefined : { transform: `translateX(${travel * toEnd}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
