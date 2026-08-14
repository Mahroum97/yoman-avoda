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
 *    are kept.
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
import { backupToJson } from '../db';
import { isNativeApp } from './save';
import { logger } from './log';

const log = logger('backup');

/** When the last automatic copy was written, on this device. */
export const LAST_BACKUP_KEY = 'yoman-last-backup';

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
 * Writes one copy now, wherever this device can put it.
 *
 * Returns where it went, or null when there was nowhere to put it — which the
 * caller reports rather than swallowing, so "backed up" is never claimed for a
 * device that cannot back anything up.
 */
export async function backupNow(): Promise<BackupWhere | null> {
  const where = backupTarget();
  if (where === 'none') return null;

  const done = log.time('automatic backup');
  try {
    const json = await backupToJson();
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
      localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()));
    } catch {
      // A device with no storage for the stamp still got the backup itself.
    }
    done();
    // Sizes and counts only, as everywhere else — never what is in the diary.
    log.info('automatic backup written', { where, bytes: json.length });
    return where;
  } catch (error) {
    done('failed');
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
    for (const old of ours.slice(14)) {
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
