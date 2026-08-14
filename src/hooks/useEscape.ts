/**
 * Escape closes whatever was opened last.
 *
 * The app grew layers one at a time — a menu, a modal, a full-screen preview,
 * a selection mode — and each arrived with its own way out and none of them
 * with a keyboard. On the Mac that is wrong in a way that is hard to unlearn:
 * every window on the machine closes with Escape, so pressing it and having
 * nothing happen reads as the app being stuck.
 *
 * **Innermost wins.** Handlers form a stack rather than all firing at once: a
 * modal opened on top of a preview mounts after it, so Escape closes the modal
 * and leaves the preview alone — which is what a second press is for. Without
 * the stack a single press would close both, and the user would be thrown two
 * screens back for one keystroke.
 */
import { useEffect, useRef } from 'react';

type Handler = () => void;

/** Live handlers, outermost first. Only the last one hears Escape. */
const stack: { run: Handler }[] = [];
let listening = false;

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  // Claimed, so a parent layer listening on its own does not also react.
  event.preventDefault();
  top.run();
}

/**
 * Runs `handler` when Escape is pressed, while this component is the innermost
 * layer that wants it. Pass `null` to stand down without unmounting — how a
 * selection mode registers only while something is selected.
 */
export function useEscape(handler: Handler | null): void {
  // The entry's identity stays stable for the lifetime of the layer, while the
  // function it calls is re-read on every press — so a handler closing over
  // fresh state does not need to re-register and lose its place in the stack.
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  const active = handler !== null;
  useEffect(() => {
    if (!active) return;

    const entry = { run: () => latest.current?.() };
    stack.push(entry);

    if (!listening) {
      document.addEventListener('keydown', onKeyDown);
      listening = true;
    }

    return () => {
      const at = stack.indexOf(entry);
      if (at >= 0) stack.splice(at, 1);
    };
  }, [active]);
}
