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

/** Which script a family carries, and therefore which slot it fills in a PDF. */
export type Script = 'hebrew' | 'arabic';

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
  /**
   * The name written into the Word file and used by the on-screen A4 preview.
   * Absent on `system`, which cannot be embedded in a PDF or named in a .docx
   * and therefore leaves the documents on their default.
   */
  docFamily?: string;
  /** Which of a PDF's two embedded slots this family fills. */
  script?: Script;
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
    docFamily: 'Heebo',
    script: 'hebrew',
    name: 'Heebo',
    stack: `'Heebo', ${SYSTEM}`,
    note: 'default',
    languages: ['he', 'en'],
  },
  {
    id: 'assistant',
    docFamily: 'Assistant',
    script: 'hebrew',
    name: 'Assistant',
    stack: `'Assistant', ${SYSTEM}`,
    note: 'friendly',
    languages: ['he', 'en'],
  },
  {
    id: 'rubik',
    docFamily: 'Rubik',
    script: 'hebrew',
    name: 'Rubik',
    stack: `'Rubik', ${SYSTEM}`,
    note: 'rounded',
    languages: ['he', 'en'],
  },
  {
    id: 'frank',
    docFamily: 'Frank Ruhl Libre',
    script: 'hebrew',
    name: 'Frank Ruhl Libre',
    stack: `'Frank Ruhl Libre', ${SYSTEM}`,
    note: 'serif',
    languages: ['he', 'en'],
  },
  {
    id: 'cousine',
    docFamily: 'Cousine',
    script: 'hebrew',
    name: 'Cousine',
    stack: `'Cousine', ui-monospace, 'SF Mono', Menlo, monospace`,
    note: 'mono',
    languages: ['he', 'en'],
  },
  {
    id: 'cairo',
    docFamily: 'Cairo',
    script: 'arabic',
    name: 'Cairo',
    stack: `'Cairo', ${SYSTEM}`,
    note: 'default',
    languages: ['ar'],
  },
  {
    id: 'tajawal',
    docFamily: 'Tajawal',
    script: 'arabic',
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
  if (!choice) return;
  const root = document.documentElement;
  root.style.setProperty('--font', choice.stack);
  /*
   * The A4 preview reads `--doc-font` rather than `--font`, because the two
   * differ in exactly one case: on `system` the screen uses the device's face
   * while the document falls back to Heebo. A preview that showed the screen's
   * font would be telling the user something untrue about the PDF.
   */
  const script: Script = language === 'ar' ? 'arabic' : 'hebrew';
  const family = choice.docFamily ?? (script === 'arabic' ? 'Cairo' : 'Heebo');
  root.style.setProperty('--doc-font', `'${family}', Arial, sans-serif`);
}

export function setFont(language: Language, id: string): void {
  if (id === DEFAULT_FONT) localStorage.removeItem(fontKey(language));
  else localStorage.setItem(fontKey(language), id);
  applyFont(language, id);
}

/* ------------------------------------------------- the documents' typeface */

/**
 * What a PDF embeds and a Word file names, per script.
 *
 * The interface and the documents share one setting — choosing a typeface is
 * meant to change the diary, not just the screen — but they cannot share the
 * *system* option: there is no file to embed, and a .docx that names the
 * reader's system font would render as something different on every machine
 * that opens it. So `system` leaves each script on the face the app has always
 * printed with.
 */
export const DOC_DEFAULT: Record<Script, string> = { hebrew: 'heebo', arabic: 'cairo' };

/** The family id a document should use for a script, given the stored choices. */
export function docFontId(script: Script): string {
  // Hebrew and Arabic are chosen under their own languages, and both slots are
  // embedded in every document so mixed-script text always has a glyph.
  const language: Language = script === 'arabic' ? 'ar' : 'he';
  const choice = fontById(readFont(language));
  if (!choice?.script || choice.script !== script) return DOC_DEFAULT[script];
  return choice.id;
}

export const docFontFamily = (script: Script): string =>
  fontById(docFontId(script))?.docFamily ?? (script === 'arabic' ? 'Cairo' : 'Heebo');

/**
 * The family named in a .docx — which is not always the one the PDF embeds.
 *
 * A Word file carries a font *name*, and Word substitutes silently when the
 * reader has not got it. Arial is the one face every Windows and macOS Word
 * install has, so a diary whose typeface was never chosen keeps naming Arial
 * rather than a Heebo that most machines would quietly replace with something
 * else. Choosing a face is a deliberate act and is honoured; not choosing one
 * should not degrade the document on the reader's screen.
 */
export function wordFontFamily(script: Script): string {
  const choice = fontById(readFont(script === 'arabic' ? 'ar' : 'he'));
  return choice?.script === script && choice.docFamily ? choice.docFamily : 'Arial';
}
