/**
 * Morning / night mode.
 *
 * The preference is resolved to a concrete `data-theme` on <html> in JS rather
 * than left to a CSS media query, so that "auto" and an explicit choice use the
 * exact same styling path. index.html applies the stored value before first
 * paint, which is what stops the app flashing white at night.
 *
 * It lives in localStorage, not IndexedDB: it is a property of this screen, not
 * of the diary, and it has to be readable synchronously at boot.
 */
import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'black' | 'auto';
export type Theme = 'light' | 'dark' | 'black';

export const THEME_KEY = 'yoman-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function readPreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'black' ? stored : 'auto';
}

/**
 * Auto follows the system, and the system only knows light and dark — so it
 * never resolves to black. Black is a deliberate choice for an OLED screen in
 * the dark, not something to be switched into by the time of day.
 */
function resolve(preference: ThemePreference): Theme {
  if (preference !== 'auto') return preference;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * The colour iOS paints the status-bar strip above the app.
 *
 * It has to match the top bar exactly, or the strip reads as a separate band
 * of the wrong colour — which is what a navy strip over a light page looked
 * like. Kept in step with `--topbar` in global.css, and duplicated in the
 * pre-paint script in index.html so the strip is right on the very first frame.
 */
export const STRIP_COLOUR: Record<Theme, string> = {
  light: '#ffffff',
  dark: '#16293f',
  black: '#000000',
};

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', STRIP_COLOUR[theme]);
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [theme, setTheme] = useState<Theme>(() => resolve(readPreference()));

  useEffect(() => {
    const next = resolve(preference);
    setTheme(next);
    apply(next);

    if (preference !== 'auto') return;
    // Follow the system while on auto.
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      const updated = resolve('auto');
      setTheme(updated);
      apply(updated);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    if (next === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
    setPreferenceState(next);
  }, []);

  /** Cycles בוקר → לילה → שחור → אוטומטי, for the one-tap button in the top bar. */
  const cycle = useCallback(() => {
    const order: ThemePreference[] = ['light', 'dark', 'black', 'auto'];
    setPreference(order[(order.indexOf(preference) + 1) % order.length]);
  }, [preference, setPreference]);

  return { preference, theme, setPreference, cycle };
}
