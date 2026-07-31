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

export type ThemePreference = 'light' | 'dark' | 'auto';
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'yoman-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function readPreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'auto';
}

function resolve(preference: ThemePreference): Theme {
  if (preference !== 'auto') return preference;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#12161c' : '#0f2d4a');
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

  /** Cycles בהיר → כהה → אוטומטי, for the one-tap button in the top bar. */
  const cycle = useCallback(() => {
    setPreference(preference === 'light' ? 'dark' : preference === 'dark' ? 'auto' : 'light');
  }, [preference, setPreference]);

  return { preference, theme, setPreference, cycle };
}
