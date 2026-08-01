/**
 * The diary's own log, kept on the device.
 *
 * The app runs on a building site, on a phone, with no console attached and
 * often no network. When something goes wrong there, the only account of it is
 * whatever the app wrote down at the time — so this exists to make "the export
 * did nothing this morning" answerable a day later.
 *
 * Four levels, in order: debug · info · warn · error. `info` is the default;
 * `debug` is deliberately opt-in because it is noisy enough to bury the lines
 * that matter.
 *
 * Three rules hold this together, and breaking any of them makes the log worse
 * than useless:
 *
 *  1. **Logging never throws and never blocks.** A logger that can break the
 *     app turns a cosmetic bug into a crash. Every path here swallows its own
 *     failures, and the worst case is a lost line.
 *  2. **The diary's contents never go in.** Work descriptions, names, notes and
 *     photos stay out; the log records what happened and how much, never what
 *     the user wrote. The log is exported and sent to other people — treat every
 *     line as public.
 *  3. **The level lives in localStorage, not IndexedDB.** A broken database is
 *     exactly when the log is needed, so deciding what to record must not depend
 *     on the thing that might be broken.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LogEntry {
  id?: number;
  /** Epoch milliseconds. */
  at: number;
  level: LogLevel;
  /** Which part of the app spoke: `pdf`, `sync`, `save`, `app`… */
  scope: string;
  message: string;
  /** Small structured extras. Never diary content. */
  detail?: string;
}

export const LOG_LEVEL_KEY = 'logLevel';
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/** Rows kept on the device; older ones are dropped as new ones arrive. */
const MAX_ROWS = 2000;
/** A single detail longer than this is cut — a stack trace is enough. */
const MAX_DETAIL = 2000;
/** Lines held in memory for the viewer, so it does not wait on the database. */
const MEMORY_ROWS = 300;

/* ------------------------------------------------------------------- level */

let level: LogLevel = readStoredLevel();

function readStoredLevel(): LogLevel {
  try {
    const stored = localStorage.getItem(LOG_LEVEL_KEY);
    return stored && (LOG_LEVELS as readonly string[]).includes(stored)
      ? (stored as LogLevel)
      : DEFAULT_LOG_LEVEL;
  } catch {
    // Private browsing can refuse localStorage entirely.
    return DEFAULT_LOG_LEVEL;
  }
}

export function getLogLevel(): LogLevel {
  return level;
}

export function setLogLevel(next: LogLevel): void {
  level = next;
  try {
    localStorage.setItem(LOG_LEVEL_KEY, next);
  } catch {
    /* the level still applies for this session */
  }
}

/* ------------------------------------------------------------------ writing */

const memory: LogEntry[] = [];
let pending: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
/** Guards against a failing write logging its own failure, forever. */
let flushing = false;

/**
 * Turns anything into a short, safe string.
 *
 * Errors keep their stack, which is the useful part. Everything else is
 * JSON with a length cap, so a caller that accidentally passes a whole diary
 * entry costs a truncated line rather than megabytes of storage.
 */
function describe(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined;
  try {
    if (detail instanceof Error) {
      const head = `${detail.name}: ${detail.message}`;
      // V8 (Chrome, the Mac app) starts a stack with "Name: message" already,
      // while JavaScriptCore (Safari and the iOS app) gives bare frames. Adding
      // the head unconditionally would print the message twice on the desktop
      // and omitting it would lose the message entirely on the phone.
      if (!detail.stack) return head.slice(0, MAX_DETAIL);
      const body = detail.stack.startsWith(detail.name) ? detail.stack : `${head}\n${detail.stack}`;
      return body.slice(0, MAX_DETAIL);
    }
    if (typeof detail === 'string') return detail.slice(0, MAX_DETAIL);
    return JSON.stringify(detail)?.slice(0, MAX_DETAIL);
  } catch {
    // Circular structures, getters that throw, DOM nodes…
    return String(detail).slice(0, MAX_DETAIL);
  }
}

function record(entryLevel: LogLevel, scope: string, message: string, detail?: unknown): void {
  if (RANK[entryLevel] < RANK[level]) return;

  const entry: LogEntry = {
    at: Date.now(),
    level: entryLevel,
    scope,
    message,
    detail: describe(detail),
  };

  memory.push(entry);
  if (memory.length > MEMORY_ROWS) memory.splice(0, memory.length - MEMORY_ROWS);

  pending.push(entry);

  if (import.meta.env.DEV) {
    const line = `[${scope}] ${message}`;
    if (entryLevel === 'error') console.error(line, detail ?? '');
    else if (entryLevel === 'warn') console.warn(line, detail ?? '');
    else console.log(line, detail ?? '');
  }

  // Errors are written out at once: whatever goes wrong next may stop the
  // timer from ever firing, and the last line before a crash is the one worth
  // having. Everything else is batched so a busy screen is not a write storm.
  if (entryLevel === 'error') {
    void flush();
  } else if (flushTimer === undefined) {
    flushTimer = setTimeout(() => void flush(), 1500);
  }
}

async function flush(): Promise<void> {
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  if (flushing || pending.length === 0) return;

  flushing = true;
  const batch = pending;
  pending = [];

  try {
    // Imported here rather than at the top so this module stays safe to use
    // from anywhere, including modules the database itself depends on.
    const { db } = await import('../db');
    await db.logs.bulkAdd(batch);

    const total = await db.logs.count();
    if (total > MAX_ROWS) {
      const stale = await db.logs
        .orderBy('at')
        .limit(total - MAX_ROWS)
        .primaryKeys();
      await db.logs.bulkDelete(stale);
    }
  } catch {
    // Storage full, database blocked by another tab, private mode. Dropping the
    // batch is correct: retrying would grow `pending` without bound, and the
    // in-memory copy still backs the viewer for this session.
  } finally {
    flushing = false;
  }
}

/** Writes anything still buffered. Called before the log is read or exported. */
export async function flushLog(): Promise<void> {
  await flush();
}

/* -------------------------------------------------------------------- entry */

export interface ScopedLogger {
  debug: (message: string, detail?: unknown) => void;
  info: (message: string, detail?: unknown) => void;
  warn: (message: string, detail?: unknown) => void;
  error: (message: string, detail?: unknown) => void;
  /**
   * Times an operation and logs how long it took.
   *
   *   const done = log.time('build entry pdf');
   *   …
   *   done();            // → debug "build entry pdf took 412ms"
   *   done('failed');    // → the same, with a note
   */
  time: (label: string) => (note?: string) => void;
}

/**
 * An export's file name reduced to what is safe to write down.
 *
 * Export names are built from the project name and the date — `יומן-מגדלי
 * הים-01-08-2026.pdf` — and this log is meant to be sent to someone else, so
 * only the extension travels. Nothing is lost for debugging: the date, the
 * language, the theme and the sizes are logged beside it, and those are what
 * actually identify a document when reading a trail back.
 */
export function fileKind(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'file';
}

/** A logger that stamps every line with where it came from. */
export function logger(scope: string): ScopedLogger {
  return {
    debug: (message, detail) => record('debug', scope, message, detail),
    info: (message, detail) => record('info', scope, message, detail),
    warn: (message, detail) => record('warn', scope, message, detail),
    error: (message, detail) => record('error', scope, message, detail),
    time: (label) => {
      const started = Date.now();
      return (note?: string) => {
        const took = Date.now() - started;
        const suffix = note ? ` (${note})` : '';
        record('debug', scope, `${label} took ${took}ms${suffix}`);
      };
    },
  };
}

/* ------------------------------------------------------------------ reading */

/** Everything on the device, newest first. */
export async function readLog(): Promise<LogEntry[]> {
  await flush();
  try {
    const { db } = await import('../db');
    const rows = await db.logs.orderBy('at').reverse().toArray();
    if (rows.length > 0) return rows;
  } catch {
    /* fall through to whatever this session remembers */
  }
  return [...memory].reverse();
}

export async function clearLog(): Promise<void> {
  pending = [];
  memory.length = 0;
  try {
    const { db } = await import('../db');
    await db.logs.clear();
  } catch {
    /* nothing to clear */
  }
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function stamp(at: number): string {
  const d = new Date(at);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

/**
 * The log as a plain text file.
 *
 * Deliberately not JSON: this gets sent through WhatsApp or Mail to whoever is
 * looking at the bug, and it has to be readable in whatever opens it. Oldest
 * first, because a fault reads forwards.
 */
export function formatLogText(entries: LogEntry[], header: string[] = []): string {
  const lines = [...header];
  if (header.length > 0) lines.push('');

  for (const entry of [...entries].reverse()) {
    lines.push(`${stamp(entry.at)}  ${entry.level.toUpperCase().padEnd(5)} [${entry.scope}] ${entry.message}`);
    if (entry.detail) {
      for (const detailLine of entry.detail.split('\n')) lines.push(`        ${detailLine}`);
    }
  }
  return lines.join('\n');
}

/** What was running when the fault happened — the first thing anyone asks. */
export function environmentReport(): string[] {
  const bits: string[] = [];
  bits.push(`יומן עבודה · log`);
  bits.push(`exported: ${stamp(Date.now())}`);
  try {
    bits.push(`platform: ${navigator.userAgent}`);
    bits.push(`language: ${navigator.language}`);
    bits.push(`screen:   ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`);
    bits.push(`online:   ${navigator.onLine}`);
  } catch {
    /* a headless build has no navigator */
  }
  bits.push(`level:    ${level}`);
  return bits;
}

/* ------------------------------------------------------- uncaught failures */

let installed = false;

/**
 * Catches what no `try` around a call site would.
 *
 * These two handlers are the reason a crash on the phone leaves a trace at all:
 * a React render that throws, a promise nobody awaited, a failing dynamic
 * import of `pdf-lib` over a bad connection.
 */
export function installGlobalLogHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const app = logger('app');

  window.addEventListener('error', (event) => {
    // A failed <img>/<script> load also fires this, without an Error object.
    if (event.error instanceof Error) {
      app.error(`uncaught: ${event.message}`, event.error);
    } else {
      app.error(`uncaught: ${event.message || 'resource failed to load'}`, {
        source: event.filename,
        line: event.lineno,
      });
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    app.error('unhandled promise rejection', event.reason);
  });

  // The last chance to get the buffer onto disk. `visibilitychange` rather than
  // `unload`, which iOS does not reliably fire when an app is backgrounded.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}
