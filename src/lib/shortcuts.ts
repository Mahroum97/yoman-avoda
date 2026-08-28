/**
 * Keyboard shortcuts — what each combination presses.
 *
 * A shortcut here can do nothing that a button on the screen cannot already do.
 * That is the whole design: every screen already *publishes* what it can do
 * (`editorActionsContext`), so a shortcut names one of those actions by its id
 * and presses it. There is no second implementation of saving or exporting to
 * keep in step with the first, and a shortcut on a screen that does not offer
 * the action simply does nothing — the same answer the missing button gives.
 *
 * **Bindings are read from `event.code`, never `event.key`, and that is not a
 * detail.** `event.key` is the letter the *layout* produces: on the Hebrew
 * keyboard this diary is written on, the S key sends `ד` and ⌘S never arrives.
 * `event.code` is the physical key — `KeyS` whatever the input source is — so
 * the shortcuts survive the language the app was built for. It is also why the
 * labels below are drawn from the code rather than from what was typed.
 *
 * The choice belongs to the device, like the view and the sort and the swipes:
 * a Mac with a keyboard and a phone without one do not want the same answer,
 * and it never reaches `SYNCED_SETTINGS`.
 */
import type { Strings } from '../i18n/strings';

export type ShortcutGroup = 'nav' | 'page' | 'app';

/** What pressing it reaches. */
export type ShortcutTarget =
  /** A screen. */
  | { kind: 'route'; path: string }
  /** A `PageAction` id, pressed on whichever screen has published one. */
  | { kind: 'action'; action: string }
  /** Something the shell itself owns. */
  | { kind: 'app'; app: 'undo' | 'redo' | 'backup' | 'theme' };

export interface ShortcutDef {
  id: string;
  group: ShortcutGroup;
  /**
   * The label is the one the button already carries. A shortcut that invented
   * its own wording would be a second name for the same action, in three
   * languages, drifting from the first.
   */
  label: (t: Strings) => string;
  target: ShortcutTarget;
  /** Canonical combination, e.g. `mod+keys`. Empty means unbound by default. */
  defaults: string;
  /**
   * Whether it still fires while the caret is in a field.
   *
   * ⌘S must: the day's description is a long textarea and saving from inside it
   * is the point. ⌘Z must not — a text field has its own undo stack, and taking
   * that over throws away a sentence when the user meant the last word. ⌘⌫ must
   * not either: inside a field that is "delete to the start of the line" on
   * every Mac, and here it would delete the day's page.
   *
   * Shortcuts with no modifier are never allowed in a field regardless — a
   * plain `P` is a letter someone is typing.
   */
  inField?: 'skip';
}

/**
 * Every shortcut the app has, in the order the settings screen lists them.
 *
 * Letters are chosen from the English word rather than the Hebrew one on
 * purpose: the binding is a physical key, and the same key has to make sense
 * to a diary kept in Hebrew, in Arabic and in English.
 */
export const SHORTCUTS: ShortcutDef[] = [
  /* Moving between screens — the five tabs and the one button beside them. */
  {
    id: 'nav-diary',
    group: 'nav',
    label: (t) => t.navDiary,
    target: { kind: 'route', path: '/' },
    defaults: 'digit1',
  },
  {
    id: 'nav-reports',
    group: 'nav',
    label: (t) => t.navReports,
    target: { kind: 'route', path: '/reports' },
    defaults: 'digit2',
  },
  {
    id: 'nav-projects',
    group: 'nav',
    label: (t) => t.navProjects,
    target: { kind: 'route', path: '/projects' },
    defaults: 'digit3',
  },
  {
    id: 'nav-contacts',
    group: 'nav',
    label: (t) => t.navContacts,
    target: { kind: 'route', path: '/contacts' },
    defaults: 'digit4',
  },
  {
    id: 'nav-settings',
    group: 'nav',
    label: (t) => t.navSettings,
    target: { kind: 'route', path: '/settings' },
    defaults: 'digit5',
  },
  {
    id: 'nav-new',
    group: 'nav',
    label: (t) => t.navNew,
    target: { kind: 'route', path: '/entry/new' },
    defaults: 'keyn',
  },

  /* The page in front of you, whichever screen published it. */
  {
    id: 'save',
    group: 'page',
    label: (t) => t.save,
    target: { kind: 'action', action: 'save' },
    defaults: 'mod+keys',
  },
  {
    id: 'pdf',
    group: 'page',
    label: (t) => t.exportPdf,
    target: { kind: 'action', action: 'pdf' },
    defaults: 'keyp',
  },
  {
    id: 'image',
    group: 'page',
    label: (t) => t.exportImage,
    target: { kind: 'action', action: 'image' },
    defaults: 'keyi',
  },
  {
    id: 'word',
    group: 'page',
    label: (t) => t.exportWord,
    target: { kind: 'action', action: 'word' },
    defaults: 'keyw',
  },
  {
    id: 'excel',
    group: 'page',
    label: (t) => t.exportExcel,
    target: { kind: 'action', action: 'excel' },
    defaults: 'keyx',
  },
  {
    id: 'preview',
    group: 'page',
    label: (t) => t.previewButton,
    target: { kind: 'action', action: 'preview' },
    defaults: 'keyv',
  },
  {
    id: 'share',
    group: 'page',
    label: (t) => t.shareButton,
    target: { kind: 'action', action: 'share' },
    defaults: 'shift+keys',
  },
  {
    id: 'delete',
    group: 'page',
    label: (t) => t.deleteEntry,
    target: { kind: 'action', action: 'delete' },
    defaults: 'mod+backspace',
    inField: 'skip',
  },

  /* The app itself, from anywhere in it. */
  {
    id: 'undo',
    group: 'app',
    label: (t) => t.undoEdit,
    target: { kind: 'app', app: 'undo' },
    defaults: 'mod+keyz',
    inField: 'skip',
  },
  {
    id: 'redo',
    group: 'app',
    label: (t) => t.redoEdit,
    target: { kind: 'app', app: 'redo' },
    defaults: 'mod+shift+keyz',
    inField: 'skip',
  },
  {
    id: 'backup',
    group: 'app',
    label: (t) => t.backupNowAction,
    target: { kind: 'app', app: 'backup' },
    defaults: 'keyb',
  },
  {
    id: 'theme',
    group: 'app',
    label: (t) => t.display,
    target: { kind: 'app', app: 'theme' },
    defaults: 'keyt',
  },
];

const STORE = 'yoman-shortcuts';

/** Only what the user changed; anything absent is the default above. */
type Bindings = Record<string, string>;

/**
 * The parsed bindings, held rather than re-read.
 *
 * Every keystroke anywhere in the app asks which shortcut it is, and answering
 * walks all of the definitions above — so reading and parsing the stored JSON
 * per definition meant eighteen `localStorage` reads for each letter typed into
 * a day's description. The store is written from one screen, which clears this.
 */
let cache: Bindings | null = null;

export function readBindings(): Bindings {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return (cache = {});
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return (cache = {});
    const out: Bindings = {};
    for (const [id, combo] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof combo === 'string') out[id] = combo;
    }
    return (cache = out);
  } catch {
    // A device that cannot read it keeps the defaults, which is what it had.
    return (cache = {});
  }
}

/** `null` unbinds it — a shortcut that does nothing is a real answer here too. */
export function writeBinding(id: string, combo: string | null): void {
  const all = { ...readBindings(), [id]: combo ?? '' };
  cache = all;
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* Stored only in memory then: it holds for this run and no longer. */
  }
}

export function resetBindings(): void {
  cache = {};
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* Same. */
  }
}

/** The combination this shortcut answers to, or `null` when it is unbound. */
export function bindingFor(id: string): string | null {
  const stored = readBindings()[id];
  if (stored !== undefined) return stored === '' ? null : stored;
  const def = SHORTCUTS.find((s) => s.id === id);
  return def && def.defaults !== '' ? def.defaults : null;
}

/** Which shortcut, if any, this combination currently belongs to. */
export function shortcutFor(combo: string): ShortcutDef | null {
  return SHORTCUTS.find((def) => bindingFor(def.id) === combo) ?? null;
}

/** The key label to print beside an action in the menu, or `null`. */
export function keyLabelForAction(action: string): string | null {
  const def = SHORTCUTS.find((s) => s.target.kind === 'action' && s.target.action === action);
  if (!def) return null;
  const combo = bindingFor(def.id);
  return combo ? comboLabel(combo) : null;
}

/**
 * The canonical name of what was pressed, or `null` for a bare modifier.
 *
 * ⌘ and Ctrl are the same `mod`: the Mac app and a Windows browser are the same
 * shortcut written once.
 */
export function comboOf(event: KeyboardEvent): string | null {
  const code = event.code;
  if (!code || /^(Meta|Control|Shift|Alt)(Left|Right)$/.test(code)) return null;
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('mod');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(code.toLowerCase());
  return parts.join('+');
}

export const hasModifier = (combo: string): boolean =>
  combo.startsWith('mod+') || combo.startsWith('alt+') || combo.includes('+alt+');

const isApple = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/** Codes whose printed name is not simply the letter after `Key`/`Digit`. */
const NAMES: Record<string, string> = {
  backspace: '⌫',
  delete: '⌦',
  enter: '↩',
  space: '␣',
  tab: '⇥',
  escape: 'Esc',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  slash: '/',
  backslash: '\\',
  period: '.',
  comma: ',',
  semicolon: ';',
  quote: "'",
  minus: '−',
  equal: '=',
  bracketleft: '[',
  bracketright: ']',
  backquote: '`',
};

/**
 * How the combination is printed.
 *
 * Always left to right, and the caller has to say so in the markup: `⌘ + S`
 * dropped into a Hebrew line is reordered by the paragraph's direction into
 * `S + ⌘`, which is the same trap the PDF's numbers are in.
 */
export function comboLabel(combo: string): string {
  const apple = isApple();
  return combo
    .split('+')
    .map((part) => {
      if (part === 'mod') return apple ? '⌘' : 'Ctrl';
      if (part === 'shift') return apple ? '⇧' : 'Shift';
      if (part === 'alt') return apple ? '⌥' : 'Alt';
      if (NAMES[part]) return NAMES[part];
      if (part.startsWith('key')) return part.slice(3).toUpperCase();
      if (part.startsWith('digit')) return part.slice(5);
      if (part.startsWith('numpad')) return part.slice(6).toUpperCase();
      return part.toUpperCase();
    })
    .join(' ');
}

/**
 * Set while the settings screen is waiting for a key.
 *
 * Without it, pressing ⌘S to *record* ⌘S saves the page underneath at the same
 * moment, and pressing 1 to record it walks off the settings screen.
 */
let recording = false;

export function setRecording(on: boolean): void {
  recording = on;
}

export const isRecording = (): boolean => recording;
