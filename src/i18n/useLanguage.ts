/**
 * Interface language, and the direction that comes with it.
 *
 * Like the theme, it lives in localStorage so it can be applied before the
 * first paint (index.html sets `lang`/`dir` from the same key) and so it is a
 * property of the device rather than of the diary data.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_LANGUAGE,
  STRINGS,
  isLanguage,
  type Direction,
  type Language,
  type Strings,
} from './strings';

export const LANGUAGE_KEY = 'yoman-lang';

export function readLanguage(): Language {
  // Guarded: the document builders also run under Node (npm run sample), where
  // there is no localStorage to read.
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    return isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function applyLanguage(language: Language): void {
  if (typeof document === 'undefined') return;
  const { dir } = STRINGS[language];
  document.documentElement.lang = language;
  document.documentElement.dir = dir;
}

/** Read the current strings outside React — used by the export helpers. */
export function currentStrings(): Strings {
  return STRINGS[readLanguage()];
}

export interface LanguageApi {
  language: Language;
  dir: Direction;
  t: Strings;
  setLanguage: (language: Language) => void;
}

export function useLanguage(): LanguageApi {
  const [language, setLanguageState] = useState<Language>(readLanguage);

  useEffect(() => {
    applyLanguage(language);
  }, [language]);

  // Keep every mounted component in step, since each one holds its own state.
  useEffect(() => {
    const onChange = () => setLanguageState(readLanguage());
    window.addEventListener('yoman-language', onChange);
    return () => window.removeEventListener('yoman-language', onChange);
  }, []);

  const setLanguage = useCallback((next: Language) => {
    localStorage.setItem(LANGUAGE_KEY, next);
    applyLanguage(next);
    setLanguageState(next);
    window.dispatchEvent(new Event('yoman-language'));
  }, []);

  return { language, dir: STRINGS[language].dir, t: STRINGS[language], setLanguage };
}
