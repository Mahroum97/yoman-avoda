/**
 * The look of the printed document, as a small set of named palettes.
 *
 * One definition feeds all three renderers — the PDF, the Word file and the
 * on-screen A4 sheet — so a report looks the same wherever it is produced.
 * Colours are hex because that is what Word wants; the PDF converts them.
 *
 * Every palette is designed to stay legible when printed in black and white,
 * which rules out mid-tone bands with white text on them.
 */

export const DOC_THEMES = ['navy', 'graphite', 'sky', 'olive', 'amber'] as const;
export type DocThemeId = (typeof DOC_THEMES)[number];

export interface DocTheme {
  id: DocThemeId;
  /** Header band and heading text. */
  band: string;
  /** The rule under the band, and the tick beside section headings. */
  accent: string;
  /** Table group header row, and the casting box heading. */
  tintGroup: string;
  /** Column header row and section bars. */
  tintHead: string;
  /** Info panels behind the project and date blocks. */
  panel: string;
  /** Every other body row. */
  row: string;
}

const THEMES: Record<DocThemeId, DocTheme> = {
  navy: {
    id: 'navy',
    band: '0F2D4A',
    accent: 'D97706',
    tintGroup: 'DCE4EE',
    tintHead: 'EFF3F8',
    panel: 'F7F9FB',
    row: 'FAFBFD',
  },
  graphite: {
    id: 'graphite',
    band: '2B2F36',
    accent: '6B7280',
    tintGroup: 'E2E4E8',
    tintHead: 'F1F2F4',
    panel: 'F8F9FA',
    row: 'FBFBFC',
  },
  sky: {
    id: 'sky',
    band: '10517F',
    accent: '0EA5E9',
    tintGroup: 'D6E9F7',
    tintHead: 'EDF6FC',
    panel: 'F6FAFD',
    row: 'FAFCFE',
  },
  olive: {
    id: 'olive',
    band: '25482F',
    accent: '4D7C0F',
    tintGroup: 'DCE7DC',
    tintHead: 'EFF4EE',
    panel: 'F7FAF7',
    row: 'FBFCFA',
  },
  amber: {
    id: 'amber',
    band: '7A4A08',
    accent: 'D97706',
    tintGroup: 'F6E7CC',
    tintHead: 'FBF3E4',
    panel: 'FDF9F2',
    row: 'FEFCF8',
  },
};

export const DEFAULT_DOC_THEME: DocThemeId = 'navy';

export function docTheme(id: string | null | undefined): DocTheme {
  return THEMES[(id ?? '') as DocThemeId] ?? THEMES[DEFAULT_DOC_THEME];
}

/** `0F2D4A` -> `#0F2D4A`, for anywhere that speaks CSS. */
export const css = (hex: string): string => `#${hex}`;

/** `0F2D4A` -> `{ r: 0.059, g: 0.176, b: 0.29 }`, for pdf-lib. */
export function rgbOf(hex: string): { r: number; g: number; b: number } {
  const value = parseInt(hex, 16);
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
  };
}

/** The settings key the choice is stored under; it travels with sync. */
export const DOC_THEME_KEY = 'documentTheme';
