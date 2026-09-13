import { useEffect, useState } from 'react';

/** Mount desktop-only queries and previews only while the viewport can use them. */
export function useWideScreen(width: number): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(`(min-width: ${width}px)`).matches);
  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${width}px)`);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [width]);
  return wide;
}
