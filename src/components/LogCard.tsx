/**
 * The activity log, in Settings.
 *
 * The point of this card is the share button. The diary runs on a phone at a
 * building site, where there is no console to open and no cable attached — so
 * the only way a fault becomes fixable is if the user can send the log out of
 * the device, which on iOS means the share sheet (`saveBlob` handles that).
 *
 * The list itself is collapsed by default and capped at the newest lines: it is
 * there so the user can see something is being recorded, not to be read on a
 * 6-inch screen.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  LOG_LEVELS,
  clearLog,
  environmentReport,
  formatLogText,
  getLogLevel,
  logger,
  readLog,
  setLogLevel,
  type LogEntry,
  type LogLevel,
} from '../lib/log';
import { saveBlob } from '../lib/save';
import { isoDate } from '../lib/dates';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { Card, Field } from './ui';
import { Icon } from './Icon';

/** How many lines the on-screen list shows; the exported file has everything. */
const PREVIEW_ROWS = 60;

const log = logger('settings');

function time(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function LogCard() {
  const { t } = useLanguage();
  const toast = useToast();

  const [level, setLevel] = useState<LogLevel>(getLogLevel);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setEntries(await readLog());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reading is cheap and the list is short, so it re-reads while open rather
  // than trying to subscribe: a log that lags a few seconds behind is fine.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [open, refresh]);

  async function share() {
    setBusy(true);
    try {
      const rows = await readLog();
      const text = formatLogText(rows, environmentReport());
      const name = `${t.fileLogPrefix}-${isoDate(new Date())}.txt`;
      await saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), name);
      log.info('log exported', { entries: rows.length });
    } catch (error) {
      log.error('log export failed', error);
      toast.error(t.logShareFailed);
    } finally {
      setBusy(false);
    }
  }

  async function wipe() {
    await clearLog();
    await refresh();
    // Written after the wipe on purpose, so the file is never mysteriously
    // empty — there is always a line saying where the history went.
    log.info('log cleared by user');
    toast.show(t.logCleared);
  }

  function changeLevel(next: LogLevel) {
    setLogLevel(next);
    setLevel(next);
    log.info(`log level set to ${next}`);
    void refresh();
  }

  return (
    <Card title={t.logTitle} note={t.logHint}>
      <Field label={t.logLevel} hint={t.logLevelHint}>
        <select
          value={level}
          onChange={(e) => changeLevel(e.target.value as LogLevel)}
        >
          {LOG_LEVELS.map((id) => (
            <option key={id} value={id}>
              {t.logLevelNames[id]}
            </option>
          ))}
        </select>
      </Field>

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || entries.length === 0}
          onClick={() => void share()}
        >
          <Icon name="share" size={16} />
          {t.logShare}
        </button>
        <button
          type="button"
          className="btn"
          disabled={entries.length === 0}
          onClick={() => setOpen((was) => !was)}
        >
          {open ? t.logHide : t.logShow}
        </button>
        <button
          type="button"
          className="btn btn--danger"
          disabled={busy || entries.length === 0}
          onClick={() => void wipe()}
        >
          {t.logClear}
        </button>
      </div>

      <p className="card__note" style={{ marginTop: 12 }}>
        {entries.length === 0 ? t.logEmpty : t.logEntries(entries.length)}
      </p>

      {open && (
        <ul className="log-list">
          {entries.slice(0, PREVIEW_ROWS).map((entry, index) => (
            <li key={entry.id ?? `${entry.at}-${index}`} className={`log-row log-row--${entry.level}`}>
              <span className="log-row__time">{time(entry.at)}</span>
              <span className="log-row__scope">{entry.scope}</span>
              <span className="log-row__message">{entry.message}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="card__note" style={{ marginTop: 12 }}>
        {t.logPrivacy}
      </p>
    </Card>
  );
}
