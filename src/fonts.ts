/**
 * The typefaces the interface can be set to, and which language each suits.
 *
 * The choice is **per language**, not one setting for the app: a Hebrew face
 * and an Arabic one are different files with different names, and a person who
 * prefers a fixed-width Hebrew has said nothing about what Arabic should look
 * like. Switching language therefore restores that language's own choice.
 *
 * Every stack ends in the system font. That is the fallback for any glyph the
 * chosen family does not carry — and it is what the app draws with before the
 * woff2 arrives, which on a phone is the first frame.
 */
import type { Language } from './i18n/strings';

export interface FontChoice {
  id: string;
  /** Shown in the picker, set in the face itself so the list previews itself. */
  name: string;
  /** What goes into `--font`. */
  stack: string;
  /** A word about what it is for, in the picker. */
  note: 'default' | 'friendly' | 'rounded' | 'serif' | 'mono' | 'system';
  /** The languages it is offered for. */
  languages: Language[];
}

/** The system stack, which every choice falls back to. */
const SYSTEM =
  "system-ui, -apple-system, 'SF Hebrew', 'Arial Hebrew', 'Segoe UI', Arial, sans-serif";

export const FONTS: FontChoice[] = [
  {
    id: 'system',
    name: 'ברירת המחדל',
    stack: SYSTEM,
    note: 'system',
    languages: ['he', 'ar', 'en'],
  },
  {
    id: 'heebo',
    name: 'Heebo',
    stack: `'Heebo', ${SYSTEM}`,
    note: 'default',
    languages: ['he', 'en'],
  },
  {
    id: 'assistant',
    name: 'Assistant',
    stack: `'Assistant', ${SYSTEM}`,
    note: 'friendly',
    languages: ['he', 'en'],
  },
  {
    id: 'rubik',
    name: 'Rubik',
    stack: `'Rubik', ${SYSTEM}`,
    note: 'rounded',
    languages: ['he', 'en'],
  },
  {
    id: 'frank',
    name: 'Frank Ruhl Libre',
    stack: `'Frank Ruhl Libre', ${SYSTEM}`,
    note: 'serif',
    languages: ['he', 'en'],
  },
  {
    id: 'cousine',
    // The hard one to find in Hebrew, and the reason this feature exists.
    name: 'Cousine',
    stack: `'Cousine', ui-monospace, 'SF Mono', Menlo, monospace`,
    note: 'mono',
    languages: ['he', 'en'],
  },
  {
    id: 'cairo',
    name: 'Cairo',
    stack: `'Cairo', ${SYSTEM}`,
    note: 'default',
    languages: ['ar'],
  },
  {
    id: 'tajawal',
    name: 'Tajawal',
    stack: `'Tajawal', ${SYSTEM}`,
    note: 'friendly',
    languages: ['ar'],
  },
];

export const fontsFor = (language: Language): FontChoice[] =>
  FONTS.filter((font) => font.languages.includes(language));

export const fontById = (id: string): FontChoice | undefined =>
  FONTS.find((font) => font.id === id);

/** `yoman-font-he`, and one per language beside it. */
export const fontKey = (language: Language): string => `yoman-font-${language}`;

export const DEFAULT_FONT = 'system';

export function readFont(language: Language): string {
  try {
    const stored = localStorage.getItem(fontKey(language));
    return stored && fontById(stored) ? stored : DEFAULT_FONT;
  } catch {
    return DEFAULT_FONT;
  }
}

/**
 * Writes the chosen stack onto `--font`, which every rule in the stylesheet
 * already reads — so one custom property is what makes the change reach the
 * whole app rather than the handful of places someone remembered to update.
 */
export function applyFont(language: Language, id: string = readFont(language)): void {
  const choice = fontById(id) ?? fontById(DEFAULT_FONT);
  if (choice) document.documentElement.style.setProperty('--font', choice.stack);
}

export function setFont(language: Language, id: string): void {
  if (id === DEFAULT_FONT) localStorage.removeItem(fontKey(language));
  else localStorage.setItem(fontKey(language), id);
  applyFont(language, id);
}
