/**
 * Backup, remembered lists and storage info.
 *
 * Backup matters more than usual here: the diary exists only on this device,
 * so "הורד גיבוי" is the single thing standing between the user and a lost
 * phone.
 */
import { useEffect, useState } from 'react';
import { saveBlob } from '../lib/save';
import type { ExportAllProgress } from '../lib/exportAll';
import type { PresetKind } from '../types';
import {
  addPreset,
  backupToJson,
  deletePreset,
  estimateUsage,
  diaryCounts,
  inspectBackup,
  restoreFromJson,
  type BackupSummary,
} from '../db';
import { formatBytes } from '../lib/images';
import { backupTarget, backupNow, lastBackupAt, STALE_MS } from '../lib/autoBackup';
import { formatDateTime } from '../lib/dates';
import { requestPersistentStorage } from '../lib/native';
import { isoDate } from '../lib/dates';
import { usePresetRows } from '../hooks/useData';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { LANGUAGES, STRINGS } from '../i18n/strings';
import { useTheme, type ThemePreference } from '../hooks/useTheme';
import { clearCompanyLogo, saveCompanyLogo, useCompanyLogo } from '../hooks/useBranding';
import { Card, Field } from '../components/ui';
import { readSwipe, writeSwipe, type SwipeActionId } from '../lib/swipeActions';
import {
  canRemind,
  readReminder,
  scheduleReminders,
  writeReminder,
  type ReminderSettings,
} from '../lib/reminder';
import { LogCard } from '../components/LogCard';
import { SignaturesCard } from '../components/SignaturesCard';
import { SyncCard } from '../components/SyncCard';
import { DocThemePicker } from '../components/DocThemePicker';
import { fontsFor, readFont, setFont } from '../fonts';
import { Icon, type IconName } from '../components/Icon';
import { setDocThemeId, useDocThemeId } from '../hooks/useDocTheme';



const PRESET_ORDER: PresetKind[] = [
  'staff',
  'role',
  'trade',
  'equipment',
  'concreteType',
  'weather',
];

export function SettingsScreen() {
  const toast = useToast();
  const presets = usePresetRows();
  const { preference, setPreference } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  // Re-read on every language change: the choice is stored per language.
  const [font, setFontState] = useState(() => readFont(language));
  const [swipes, setSwipes] = useState(() => ({
    start: readSwipe('start'),
    end: readSwipe('end'),
  }));
  const [reminder, setReminder] = useState(readReminder);

  /**
   * Stores the choice and lays the notifications again.
   *
   * The permission prompt is iOS's and comes on the first switch-on; if it is
   * refused the switch goes back off rather than sitting there claiming to be
   * on while nothing is scheduled.
   */
  const applyReminder = async (next: ReminderSettings) => {
    writeReminder(next);
    setReminder(next);
    const ok = await scheduleReminders(t.reminderBody, t.appName);
    if (next.on && !ok) {
      writeReminder({ ...next, on: false });
      setReminder({ ...next, on: false });
      toast.error(t.reminderDenied);
    }
  };

  const presetLabels: Record<PresetKind, string> = {
    staff: t.presetStaff,
    role: t.presetRole,
    trade: t.presetTrade,
    equipment: t.presetEquipment,
    weather: t.presetWeather,
    concreteType: t.presetConcrete,
  };

  const themeOptions: { value: ThemePreference; label: string; hint: string; icon: IconName }[] = [
    { value: 'light', label: t.themeLight, hint: t.themeLightHint, icon: 'sun' },
    { value: 'dark', label: t.themeDark, hint: t.themeDarkHint, icon: 'moon' },
    { value: 'black', label: t.themeBlack, hint: t.themeBlackHint, icon: 'black' },
    { value: 'auto', label: t.themeAuto, hint: t.themeAutoHint, icon: 'auto' },
  ];
  const companyLogo = useCompanyLogo();
  const docThemeId = useDocThemeId();
  useEffect(() => setFontState(readFont(language)), [language]);

  const [lastBackup, setLastBackup] = useState<number | null>(() => lastBackupAt());
  const backupWhere = backupTarget();
  const backupStale = lastBackup === null || Date.now() - lastBackup > STALE_MS;

  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [newValue, setNewValue] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Non-null only while the archive is being built, so the button can count.
  const [exportAll, setExportAll] = useState<ExportAllProgress | null>(null);

  useEffect(() => {
    void estimateUsage().then(setUsage);
    void requestPersistentStorage().then(setPersisted);
  }, [presets]);

  const backup = async () => {
    setBusy(true);
    try {
      const json = await backupToJson();
      const saved = await saveBlob(
        new Blob([json], { type: 'application/json' }),
        `${t.fileBackupPrefix}-${isoDate()}.json`,
      );
      if (saved) {
        toast.show(t.backupDownloaded);
        // A copy the user asked for is still a copy: it counts against the
        // "how long since the last one" warning like an automatic one does.
        await backupNow();
        setLastBackup(lastBackupAt());
      }
    } catch {
      toast.error(t.backupFailed);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Everything, as documents, in one archive.
   *
   * The slowest thing the app does — a PDF per day, each with its photos — so
   * it reports progress rather than freezing behind a spinner.
   */
  const exportEverything = async () => {
    setBusy(true);
    setExportAll({ done: 0, total: 0, project: '' });
    try {
      const { buildEverythingZip } = await import('../lib/exportAll');
      const result = await buildEverythingZip(setExportAll, companyLogo);
      // The archive is only "done" once it has somewhere to be. This is the
      // one the log caught: nine pages built, the dialog cancelled, and the app
      // announcing an export the user never received.
      if (await saveBlob(result.blob, result.name)) {
        toast.show(t.exportAllDone(result.entries, result.projects));
      }
    } catch (error) {
      const empty = error instanceof Error && error.message === 'EMPTY';
      toast.error(empty ? t.exportAllEmpty : t.exportAllFailed);
    } finally {
      setBusy(false);
      setExportAll(null);
    }
  };

  /**
   * Restoring replaces the diary, so the question is asked with the numbers.
   *
   * The file is read and counted first: how many pages and photographs it
   * holds, up to what date, against how many pages are on the device now. A
   * backups folder is a list of near-identical names, and one of them is
   * usually a copy taken while the diary was empty — the old warning said the
   * same words for that file as for the right one.
   */
  const restore = async (file: File) => {
    let json: string;
    let summary: BackupSummary;
    let device: { projects: number; entries: number };
    try {
      json = await file.text();
      summary = inspectBackup(json);
      device = await diaryCounts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.restoreFailed);
      return;
    }

    // An empty file against a diary that has something in it is asked twice.
    if (summary.entries === 0 && device.entries > 0) {
      if (!window.confirm(t.confirmRestoreEmpty(device.entries))) return;
    }
    if (!window.confirm(t.confirmRestoreCounts(summary, device))) return;

    setBusy(true);
    try {
      const result = await restoreFromJson(json);
      toast.show(t.restored(result.projects, result.entries));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.restoreFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 style={{ marginBottom: 16 }}>{t.settingsTitle}</h1>

      <Card title={t.language} note={t.languageHint}>
        <div className="segmented">
          {LANGUAGES.map((code) => (
            <button
              key={code}
              type="button"
              className="segmented__item"
              aria-pressed={language === code}
              onClick={() => setLanguage(code)}
              lang={code}
            >
              <span>{STRINGS[code].languageName}</span>
              <span className="segmented__hint">{STRINGS[code].dir.toUpperCase()}</span>
            </button>
          ))}
        </div>
      </Card>

      <SyncCard />

      <Card title={t.display} note={t.displayHint}>
        <div className="segmented">
          {themeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className="segmented__item"
              aria-pressed={preference === option.value}
              onClick={() => setPreference(option.value)}
            >
              <Icon name={option.icon} size={19} />
              <span>{option.label}</span>
              <span className="segmented__hint">{option.hint}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card title={t.fontTitle} note={t.fontHint}>
        <div className="fonts">
          {fontsFor(language).map((option) => (
            <button
              key={option.id}
              type="button"
              className="fonts__item"
              aria-pressed={font === option.id}
              onClick={() => {
                setFont(language, option.id);
                setFontState(option.id);
              }}
            >
              {/* Set in the face it offers, so the list is its own preview —
                  a name in the current font tells you nothing about the one
                  you are about to choose. */}
              <span className="fonts__sample" style={{ fontFamily: option.stack }}>
                {t.fontSample}
              </span>
              <span className="fonts__name">
                {option.name}
                <span className="fonts__note">{t.fontNote(option.note)}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      {/*
        Which action each swipe on a diary row reaches.

        The gestures are not new and neither are the actions — pinning,
        deleting and exporting are what a row has always been able to do. What
        was fixed, and is now a choice, is which of them a swipe lands on, and
        `ללא` is a real answer: a swipe that does nothing is what someone who
        has deleted a day by accident actually wants.
      */}
      {/*
        The daily reminder. It is a local notification scheduled on the device,
        so it works with no signal — and so it only exists in the installed app;
        a browser tab cannot schedule anything for tomorrow evening, and the
        card says so rather than offering a switch that does nothing.
      */}
      <Card title={t.reminderTitle} note={t.reminderHint}>
        {canRemind() ? (
          <div className="stack">
            <label className="swipeset">
              <span className="swipeset__label">{t.reminderOn}</span>
              <input
                type="checkbox"
                checked={reminder.on}
                style={{ width: 22, height: 22, minHeight: 0, flex: 'none' }}
                onChange={(e) => void applyReminder({ ...reminder, on: e.target.checked })}
              />
            </label>
            <label className="swipeset">
              <span className="swipeset__label">{t.reminderAt}</span>
              <input
                type="time"
                value={reminder.time}
                disabled={!reminder.on}
                style={{ flex: 'none', inlineSize: '12ch' }}
                onChange={(e) => void applyReminder({ ...reminder, time: e.target.value })}
              />
            </label>
          </div>
        ) : (
          <p className="muted small">{t.reminderOnlyNative}</p>
        )}
      </Card>

      <Card title={t.swipesTitle} note={t.swipesBlurb}>
        <div className="stack">
          {(
            [
              [t.swipeLeft, t.dir === 'rtl' ? 'start' : 'end'],
              [t.swipeRight, t.dir === 'rtl' ? 'end' : 'start'],
            ] as const
          ).map(([label, edge]) => (
            <label className="swipeset" key={edge}>
              <span className="swipeset__label">{label}</span>
              <select
                value={swipes[edge]}
                onChange={(e) => {
                  const action = e.target.value as SwipeActionId;
                  writeSwipe(edge, action);
                  setSwipes((current) => ({ ...current, [edge]: action }));
                }}
              >
                <option value="pin">{t.pinAction}</option>
                <option value="delete">{t.deleteAction}</option>
                <option value="export">{t.exportPdf}</option>
                <option value="none">{t.swipeNone}</option>
              </select>
            </label>
          ))}
        </div>
      </Card>

      <Card title={t.docThemeTitle} note={t.docThemeHint}>
        <DocThemePicker value={docThemeId} onChange={(id) => void setDocThemeId(id)} />
      </Card>

      <Card title={t.companyLogo} note={t.companyLogoHint}>
        <div className="row row--wrap">
          <div className="logo-slot">
            {companyLogo ? (
              <img src={companyLogo} alt="לוגו החברה" />
            ) : (
              <span className="muted small">{t.noLogo}</span>
            )}
          </div>
          <div className="btn-row">
            <label className="btn btn--primary">
              {companyLogo ? t.replaceLogo : t.uploadLogo}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  try {
                    await saveCompanyLogo(file);
                    toast.show(t.logoSaved);
                  } catch {
                    toast.error(t.logoFailed);
                  }
                }}
              />
            </label>
            {companyLogo && (
              <button
                type="button"
                className="btn btn--danger"
                onClick={async () => {
                  await clearCompanyLogo();
                  toast.show(t.logoRemoved);
                }}
              >
                {t.remove}
              </button>
            )}
          </div>
        </div>
      </Card>

      <SignaturesCard />

      <Card title={t.backupTitle} note={t.backupHint}>
        {/* Said plainly, and in the app's own words rather than a green tick:
            a backup nobody can see the age of is one nobody notices has
            stopped, which is exactly how this diary came to have none. */}
        <p className={`backup-state${backupStale ? ' backup-state--stale' : ''}`}>
          <Icon name={backupStale ? 'warning' : 'check'} size={17} />
          <span>
            {lastBackup === null
              ? t.backupNever
              : t.backupLast(formatDateTime(lastBackup, language) ?? '')}
            {' · '}
            {t.backupWhere(backupWhere)}
          </span>
        </p>

        <div className="btn-row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void backup()}
          >
            <Icon name="download" size={17} />
            {t.downloadBackup}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void exportEverything()}
            title={t.exportAllHint}
          >
            {exportAll
              ? t.exportAllWorking(exportAll.done, exportAll.total)
              : t.exportAll}
          </button>
          <label className="btn">
            <Icon name="upload" size={17} />
            {t.restoreBackup}
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void restore(file);
              }}
            />
          </label>
        </div>
        <p className="card__note" style={{ marginTop: 12 }}>
          {t.exportAllHint}
        </p>
        {usage && usage.quota > 0 && (
          <p className="card__note" style={{ marginTop: 12 }}>
            {t.storageUsage(formatBytes(usage.used), formatBytes(usage.quota))}
          </p>
        )}
        {persisted === false && (
          <p className="card__note" style={{ marginTop: 6, color: 'var(--accent)' }}>
            {t.storageNotPersisted}
          </p>
        )}
      </Card>

      <Card title={t.savedLists} note={t.savedListsHint}>
        {PRESET_ORDER.map((kind) => {
          const rows = presets?.filter((row) => row.kind === kind) ?? [];
          return (
            <div key={kind} style={{ marginBottom: 20 }}>
              <h3 style={{ marginBottom: 8 }}>{presetLabels[kind]}</h3>
              <div className="row row--wrap" style={{ gap: 6, marginBottom: 8 }}>
                {rows.length === 0 && <span className="muted small">{t.noValuesYet}</span>}
                {rows.map((row) => (
                  <span className="chip" key={row.id}>
                    {row.value}
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      style={{ minHeight: 20, padding: '0 4px' }}
                      aria-label={`${t.delete} ${row.value}`}
                      onClick={() => void deletePreset(row.id!)}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="row">
                <input
                  type="text"
                  value={newValue[kind] ?? ''}
                  placeholder={t.addTo(presetLabels[kind])}
                  onChange={(e) =>
                    setNewValue((current) => ({ ...current, [kind]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    const value = (newValue[kind] ?? '').trim();
                    if (!value) return;
                    void addPreset(kind, value);
                    setNewValue((current) => ({ ...current, [kind]: '' }));
                  }}
                />
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => {
                    const value = (newValue[kind] ?? '').trim();
                    if (!value) return;
                    void addPreset(kind, value);
                    setNewValue((current) => ({ ...current, [kind]: '' }));
                  }}
                >
                  {t.add}
                </button>
              </div>
            </div>
          );
        })}
      </Card>

      <LogCard />

      <Card title={t.about}>
        <p className="small">{t.aboutBody}</p>
        <Field label="">
          <span className="muted small">{t.installTip}</span>
        </Field>
      </Card>
    </div>
  );
}
