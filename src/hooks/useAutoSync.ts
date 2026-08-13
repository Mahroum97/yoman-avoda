/**
 * Keeps the diary current by itself whenever the paired devices can see each
 * other.
 *
 * The point is that nobody should have to remember to press "sync now". You
 * open the app on site and it is already up to date; you finish a page on the
 * phone and the Mac has it without being told.
 *
 * What it deliberately does *not* do:
 *
 *  - **Nag.** A sync that finds nothing says nothing. Only a sync that actually
 *    moved records reports, and a failure is left to the log rather than thrown
 *    in front of someone mid-form — a phone at a building site drops off the
 *    Wi-Fi constantly and a toast every time would be noise.
 *  - **Run in the background.** It only fires while the app is open and
 *    visible. A web app cannot sync while closed, and pretending otherwise
 *    would mean a promise the app cannot keep.
 *  - **Overlap.** `syncNow` holds a lock; this checks it too so a scheduled run
 *    quietly stands down while the button is working.
 */
import { useEffect, useRef } from 'react';
import { isSyncing, readPeer, syncNow } from '../sync/client';
import { logger } from '../lib/log';

const log = logger('autosync');

export const AUTO_SYNC_KEY = 'autoSync';

/** How often to try again while the app stays open. */
const EVERY_MS = 5 * 60 * 1000;
/** Ignore a wake-up that lands within this of the last attempt. */
const MIN_GAP_MS = 30 * 1000;

export function autoSyncEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_SYNC_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAutoSyncEnabled(on: boolean): void {
  try {
    localStorage.setItem(AUTO_SYNC_KEY, on ? 'on' : 'off');
  } catch {
    /* the choice still applies for this session */
  }
}

export function useAutoSync(onSynced?: (received: number) => void): void {
  const lastTry = useRef(0);
  const handler = useRef(onSynced);
  handler.current = onSynced;

  useEffect(() => {
    let stopped = false;

    const attempt = async (why: string) => {
      if (stopped || !autoSyncEnabled()) return;
      // Nothing to sync with until the device has been paired once, by hand.
      const peer = readPeer();
      if (!peer) return;
      if (isSyncing()) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastTry.current < MIN_GAP_MS) return;

      lastTry.current = Date.now();
      try {
        const outcome = await syncNow(peer);
        const moved =
          outcome.received.projects +
          outcome.received.entries +
          outcome.received.contacts +
          outcome.received.deleted +
          outcome.sent.projects +
          outcome.sent.entries;
        if (moved > 0) {
          log.info('auto sync moved records', { why, moved });
          handler.current?.(
            outcome.received.projects +
              outcome.received.entries +
              outcome.received.contacts,
          );
        } else {
          log.debug('auto sync found nothing', { why });
        }
      } catch (error) {
        // Expected often enough to be uninteresting: the Mac is asleep, the
        // phone is on mobile data, the app is not running over there. Recorded
        // at warning level so a real pattern is still visible in the log.
        const reason = error instanceof Error ? error.message : 'unknown';
        if (reason !== 'BUSY') log.warn('auto sync did not complete', { why, reason });
      }
    };

    void attempt('opened');

    const onVisible = () => {
      if (document.visibilityState === 'visible') void attempt('foreground');
    };
    const onOnline = () => void attempt('back online');

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => void attempt('timer'), EVERY_MS);

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, []);
}
