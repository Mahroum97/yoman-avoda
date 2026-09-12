/**
 * Backups that happen whether or not anyone remembers to make them.
 *
 * The manual backup in Settings was always there, and it did not save this
 * diary: the files on disk were from the 31st of July and the 2nd of August,
 * two days apart and then nothing. That is not carelessness, it is what every
 * system that depends on discipline produces. So this one asks for nothing.
 *
 * Where a copy can go depends on the platform, and each does what it can:
 *
 *  - **Mac** — a dated file in `Documents/יומן עבודה - גיבויים`, written with
 *    no dialog. Visible in Finder, swept up by Time Machine, and thirty of them
 *    are kept — six on a phone, where every copy holds every photo and there is
 *    neither the room nor a Time Machine behind it.
 *  - **iPhone / iPad** — the app's own Documents folder, which is included in
 *    the device's iCloud backup and (with the Info.plist keys that go with this
 *    file) shows up in the Files app under "On My iPhone".
 *  - **A browser** — nothing can be written silently, so the app keeps track of
 *    how long it has been and says so instead of pretending.
 *
 * Two rules it must obey, both learned from the log:
 *
 *  - **It never throws.** A backup that fails must not take a save or a launch
 *    down with it; the worst case is a line in the log and a warning in Settings.
 *  - **It never blocks the first paint.** It runs after the app is up, because
 *    serialising a diary full of photos takes long enough to be felt.
 */
import { createBackupSnapshot, currentBackupStateSignature } from '../db';
import { isNativeApp } from './save';
import { logger } from './log';
import { flushPendingWrites } from './pendingWrites';

const log = logger('backup');

/** When the last automatic copy was written, on this device. */
export const LAST_BACKUP_KEY = 'yoman-last-backup';

/** Fingerprint of the exact database snapshot in the last automatic file. */
export const LAST_BACKUP_STATE_KEY = 'yoman-last-backup-state';

/** How often one is due. Often enough to matter, rare enough to go unnoticed. */
const EVERY_MS = 12 * 60 * 60 * 1000;

/** After this long with nothing written, Settings starts saying so. */
export const STALE_MS = 3 * 24 * 60 * 60 * 1000;

export type BackupWhere = 'mac' | 'device' | 'none';

/** Where this platform can put a copy without asking anyone. */
export function backupTarget(): BackupWhere {
  if (typeof window === 'undefined') return 'none';
  if (window.yoman?.autoBackup) return 'mac';
  if (isNativeApp()) return 'device';
  return 'none';
}

export function lastBackupAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY);
    const at = raw ? Number(raw) : NaN;
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

const stamp = (): string => {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
};

/**
 * Whether anything has changed since the last copy was taken.
 *
 * A backup carries every photo in the diary, so an unchanged one written again
 * every launch is tens of megabytes of duplicate on a phone — and a folder of
 * fourteen identical copies is not fourteen times safer than one. The compact
 * fingerprint covers every table represented by the backup plus tombstones;
 * comparing only the newest diary page missed project, setting, preset and
 * deletion-only changes. An existing installation without a fingerprint takes
 * one fresh copy to seed it safely.
 */
async function changedSinceLastBackup(): Promise<boolean> {
  try {
    const backed = localStorage.getItem(LAST_BACKUP_STATE_KEY);
    if (backed === null) return true;
    return (await currentBackupStateSignature()) !== backed;
  } catch {
    // If the question cannot be answered, take the copy. Backing up too often
    // is a cost; backing up too rarely is the thing this file exists to stop.
    return true;
  }
}

/**
 * Writes one copy now, wherever this device can put it.
 *
 * Returns where it went, or null when there was nowhere to put it — which the
 * caller reports rather than swallowing, so "backed up" is never claimed for a
 * device that cannot back anything up. `force` is for the button in the bar: a
 * press is an instruction, and skipping it because nothing changed would look
 * like the button doing nothing at all.
 */
export async function backupNow(options: { force?: boolean } = {}): Promise<BackupWhere | null> {
  const where = backupTarget();
  if (where === 'none') return null;

  let done: ((note?: string) => void) | null = null;
  try {
    // The decision itself must see the latest in-memory edit. Flushing only in
    // `createBackupSnapshot` would let an automatic run decide "unchanged" and
    // return before the editor's debounce reached IndexedDB.
    await flushPendingWrites();

    if (!options.force && !(await changedSinceLastBackup())) {
      // No file was written, so the age shown in Settings remains the age of
      // the real copy on disk. Advancing it here made a fortnight-old file look
      // newly current even when the change detector had missed a table.
      log.debug('automatic backup skipped — nothing changed');
      return where;
    }

    done = log.time('automatic backup');
    const snapshot = await createBackupSnapshot({ flush: false });
    const { json } = snapshot;
    const name = `גיבוי-יומן-עבודה-${stamp()}.json`;

    if (where === 'mac') {
      const bytes = new TextEncoder().encode(json);
      const result = await window.yoman!.autoBackup!(name, bytes);
      if (!result?.saved) {
        done('failed');
        log.warn('automatic backup could not be written', { reason: result?.error });
        return null;
      }
    } else {
      // iOS: the app's own Documents directory. `Directory.Documents` is the
      // one place a Capacitor app may write that the system backs up and the
      // Files app can show.
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      await Filesystem.writeFile({
        path: name,
        data: json,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      await pruneDeviceBackups();
    }

    try {
      // State first: if localStorage fills between these writes, the missing
      // time causes another due check rather than a fresh-looking stale copy.
      localStorage.setItem(LAST_BACKUP_STATE_KEY, snapshot.stateSignature);
      localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()));
    } catch {
      // A device with no storage for the stamp still got the backup itself.
    }
    done();
    // Sizes and counts only, as everywhere else — never what is in the diary.
    log.info('automatic backup written', { where, bytes: json.length });
    return where;
  } catch (error) {
    done?.('failed');
    log.error('automatic backup failed', error);
    return null;
  }
}

/** Keeps the phone's Documents folder from growing without end. */
async function pruneDeviceBackups(): Promise<void> {
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { files } = await Filesystem.readdir({ path: '', directory: Directory.Documents });
    const ours = files
      .map((f) => (typeof f === 'string' ? f : f.name))
      .filter((n) => n.startsWith('גיבוי-יומן-עבודה-') && n.endsWith('.json'))
      .sort()
      .reverse();
    // Fewer than the Mac keeps: every copy holds every photo, and a phone
    // has neither the room nor a Time Machine behind it.
    for (const old of ours.slice(6)) {
      await Filesystem.deleteFile({ path: old, directory: Directory.Documents });
    }
  } catch (error) {
    // Pruning is housekeeping; failing at it is not worth reporting loudly.
    log.debug('could not prune old backups', { reason: String(error) });
  }
}

/**
 * Called once when the app opens.
 *
 * Deliberately *not* on a timer as well: a diary is edited in bursts and closed,
 * and a copy taken at every launch that is more than twelve hours after the last
 * one covers that far better than a clock ticking in a hidden tab. It waits a
 * few seconds so it never competes with the first render.
 */
export function scheduleAutoBackup(): void {
  if (backupTarget() === 'none') return;
  const last = lastBackupAt();
  if (last !== null && Date.now() - last < EVERY_MS) return;

  window.setTimeout(() => {
    void backupNow();
  }, 4000);
}
