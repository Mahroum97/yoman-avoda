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
 * The window is fourteen individual notifications rather than one repeating
 * alarm, and that is what lets today's be dropped once the day has been
 * written: a repeating alarm cannot be told to skip an occurrence. The window
 * is laid again on every launch, which for an app opened most days keeps it
 * full.
 *
 * **Fourteen reminders, not fourteen days.** Which weekdays are asked about is
 * a setting — Saturday is not a working day on most sites here, and Friday is
 * not on others — and counting calendar days would have meant that someone who
 * asks only for Sunday gets two reminders and then silence. The loop walks the
 * calendar and takes the days that were chosen, so one day a week is fourteen
 * weeks of cover rather than a fortnight of mostly nothing.
 */
import { isNativeApp } from './save';
import { logger } from './log';

const log = logger('reminder');

const ON_KEY = 'yoman-reminder-on';
const TIME_KEY = 'yoman-reminder-time';
const DAYS_KEY = 'yoman-reminder-days';

/** Late afternoon: the work is done and the phone is still in a pocket, not a drawer. */
export const DEFAULT_TIME = '17:00';

/** How many reminders are laid down at a time — not how many days ahead. */
const WINDOW = 14;
/**
 * How far the calendar is walked to find them.
 *
 * Enough that even a single chosen weekday fills the window, and bounded so a
 * setting with no days at all ends the loop rather than running it forever.
 */
const HORIZON = WINDOW * 7;
/** Ours, so cancelling can never touch a notification some other part posts. */
const FIRST_ID = 4100;

export interface ReminderSettings {
  on: boolean;
  /** `HH:MM`, in the device's own time. */
  time: string;
  /**
   * Which weekdays to ask about, indexed the way `Date.getDay()` counts —
   * 0 is Sunday, which is the first working day of the week here.
   */
  days: boolean[];
}

/** Every day, which is what the reminder did before it could be told otherwise. */
export const ALL_DAYS = [true, true, true, true, true, true, true];

function parseDays(raw: string | null): boolean[] {
  // Seven characters, one per weekday. Anything else is a value written by a
  // build that did not have this setting, and every day is what it meant.
  if (!raw || raw.length !== 7 || !/^[01]{7}$/.test(raw)) return [...ALL_DAYS];
  return [...raw].map((c) => c === '1');
}

export function readReminder(): ReminderSettings {
  try {
    const time = localStorage.getItem(TIME_KEY);
    return {
      on: localStorage.getItem(ON_KEY) === '1',
      time: /^\d{2}:\d{2}$/.test(time ?? '') ? (time as string) : DEFAULT_TIME,
      days: parseDays(localStorage.getItem(DAYS_KEY)),
    };
  } catch {
    return { on: false, time: DEFAULT_TIME, days: [...ALL_DAYS] };
  }
}

export function writeReminder(settings: ReminderSettings): void {
  try {
    localStorage.setItem(ON_KEY, settings.on ? '1' : '0');
    localStorage.setItem(TIME_KEY, settings.time);
    localStorage.setItem(DAYS_KEY, settings.days.map((on) => (on ? '1' : '0')).join(''));
  } catch {
    // Then it is off after a restart, which is the safe direction to fail in.
  }
}

/** Whether this device can be reminded at all. */
export const canRemind = (): boolean => isNativeApp();

/**
 * When the next reminders fall, oldest first.
 *
 * Pulled out of the scheduling so the arithmetic can be looked at on its own:
 * the choice of days turns a straight loop over a fortnight into a walk down
 * the calendar, and the cases that go wrong quietly — one weekday chosen, none
 * chosen, today's time already past — are the ones nobody sees until a
 * reminder does not arrive.
 */
export function plannedReminders(
  settings: ReminderSettings,
  now: Date,
  writtenToday: boolean,
): Date[] {
  if (!settings.on) return [];
  const [hours, minutes] = settings.time.split(':').map(Number);
  const times: Date[] = [];

  for (let offset = 0; offset < HORIZON && times.length < WINDOW; offset += 1) {
    const at = new Date(now);
    at.setDate(at.getDate() + offset);
    at.setHours(hours, minutes, 0, 0);
    // Not a day that was asked for.
    if (!settings.days[at.getDay()]) continue;
    // Today counts as done the moment the page exists — the reminder is for
    // the days that were missed, not a bell that rings whatever happened.
    if (offset === 0 && (writtenToday || at <= now)) continue;
    times.push(at);
  }

  return times;
}

/**
 * Lays the next reminders down, and drops today's if the day is already
 * written or its time has gone.
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

    const { db } = await import('../db');
    const today = new Date().toISOString().slice(0, 10);
    const written = (await db.entries.where('date').equals(today).count()) > 0;

    // The id is which of ours this is, not how far away it is: the cancel above
    // clears `FIRST_ID` upwards, and that range has to keep covering everything
    // laid down however far into the calendar the chosen days are spread.
    const notifications = plannedReminders(settings, new Date(), written).map((at, index) => ({
      id: FIRST_ID + index,
      title,
      body,
      schedule: { at },
    }));

    if (notifications.length > 0) await LocalNotifications.schedule({ notifications });
    log.info('reminders scheduled', {
      count: notifications.length,
      time: settings.time,
      days: settings.days.filter(Boolean).length,
    });
    return true;
  } catch (error) {
    log.warn('scheduling reminders failed', error);
    return false;
  }
}
