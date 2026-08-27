/**
 * The daily nudge to write the day's page.
 *
 * A site diary is worth nothing with holes in it, and the day it is easiest to
 * miss is the day that ran long — which is exactly the day nobody opens the app
 * at six in the evening. So the phone asks.
 *
 * It is a **local** notification: scheduled on the device, fired by iOS,
 * working with no signal and no server, like everything else here. That also
 * decides where it works — the installed iPhone app. A browser tab cannot
 * schedule anything for tomorrow evening, and saying so is better than a
 * setting that quietly does nothing.
 *
 * The window is two weeks of individual notifications rather than one repeating
 * one, and that is what lets today's be dropped once the day has been written:
 * a repeating alarm cannot be told to skip an occurrence. The window is laid
 * again on every launch, which for an app opened most days keeps it full.
 */
import { isNativeApp } from './save';
import { logger } from './log';

const log = logger('reminder');

const ON_KEY = 'yoman-reminder-on';
const TIME_KEY = 'yoman-reminder-time';

/** Late afternoon: the work is done and the phone is still in a pocket, not a drawer. */
export const DEFAULT_TIME = '17:00';

/** How many days ahead are laid down at a time. */
const WINDOW = 14;
/** Ours, so cancelling can never touch a notification some other part posts. */
const FIRST_ID = 4100;

export interface ReminderSettings {
  on: boolean;
  /** `HH:MM`, in the device's own time. */
  time: string;
}

export function readReminder(): ReminderSettings {
  try {
    const time = localStorage.getItem(TIME_KEY);
    return {
      on: localStorage.getItem(ON_KEY) === '1',
      time: /^\d{2}:\d{2}$/.test(time ?? '') ? (time as string) : DEFAULT_TIME,
    };
  } catch {
    return { on: false, time: DEFAULT_TIME };
  }
}

export function writeReminder(settings: ReminderSettings): void {
  try {
    localStorage.setItem(ON_KEY, settings.on ? '1' : '0');
    localStorage.setItem(TIME_KEY, settings.time);
  } catch {
    // Then it is off after a restart, which is the safe direction to fail in.
  }
}

/** Whether this device can be reminded at all. */
export const canRemind = (): boolean => isNativeApp();

/**
 * Lays the next fortnight of reminders, and drops today's if the day is
 * already written or its time has gone.
 *
 * Never throws: a reminder that cannot be scheduled must not take the launch
 * with it.
 */
export async function scheduleReminders(body: string, title: string): Promise<boolean> {
  if (!canRemind()) return false;

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const ids = Array.from({ length: WINDOW }, (_, i) => ({ id: FIRST_ID + i }));
    await LocalNotifications.cancel({ notifications: ids });

    const settings = readReminder();
    if (!settings.on) {
      log.info('reminders cleared');
      return true;
    }

    const granted = await LocalNotifications.requestPermissions();
    if (granted.display !== 'granted') {
      log.warn('reminders not permitted');
      return false;
    }

    const [hours, minutes] = settings.time.split(':').map(Number);
    const now = new Date();

    // Today counts as done the moment the page exists — the reminder is for the
    // days that were missed, not a bell that rings whatever happened.
    const { db } = await import('../db');
    const today = new Date().toISOString().slice(0, 10);
    const written = (await db.entries.where('date').equals(today).count()) > 0;

    const notifications = [];
    for (let day = 0; day < WINDOW; day += 1) {
      const at = new Date(now);
      at.setDate(at.getDate() + day);
      at.setHours(hours, minutes, 0, 0);
      if (day === 0 && (written || at <= now)) continue;
      notifications.push({
        id: FIRST_ID + day,
        title,
        body,
        schedule: { at },
      });
    }

    if (notifications.length > 0) await LocalNotifications.schedule({ notifications });
    log.info('reminders scheduled', { count: notifications.length, time: settings.time });
    return true;
  } catch (error) {
    log.warn('scheduling reminders failed', error);
    return false;
  }
}
