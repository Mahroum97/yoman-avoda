/**
 * Fits the A4 preview sheets to the screen.
 *
 * The sheets are drawn at their real size (794px = 210mm at 96dpi) so the
 * preview stays a truthful picture of the printed page. On a phone that is
 * wider than the screen, so the stack is scaled down to fit rather than making
 * the user scroll sideways through a document.
 *
 * `zoom` rather than `transform: scale()`: zoom shrinks the layout box itself,
 * so the surrounding page height is right automatically and nothing has to be
 * re-centred — which matters here, where the container may be RTL or LTR.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Width of one sheet, matching `.sheet` in the stylesheet. */
const SHEET_WIDTH = 794;

export function SheetScaler({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const fit = () => {
      // `clientWidth` of the frame, which clips its content, is the one
      // measurement the oversized sheet inside cannot influence. Measuring the
      // rendered box instead would feed the overflow back into the scale.
      const available = frame.clientWidth;
      if (available > 0) setScale(Math.min(1, available / SHEET_WIDTH));
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="sheet-frame" ref={frameRef}>
      <div className="sheet-frame__content" style={{ zoom: scale }}>
        {children}
      </div>
    </div>
  );
}
