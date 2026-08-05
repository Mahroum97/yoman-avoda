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
  restoreFromJson,
} from '../db';
import { formatBytes } from '../lib/images';
import { requestPersistentStorage } from '../lib/native';
import { isoDate } from '../lib/dates';
import { usePresetRows } from '../hooks/useData';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { LANGUAGES, STRINGS } from '../i18n/strings';
import { useTheme, type ThemePreference } from '../hooks/useTheme';
import { clearCompanyLogo, saveCompanyLogo, useCompanyLogo } from '../hooks/useBranding';
import { Card, Field } from '../components/ui';
import { LogCard } from '../components/LogCard';
import { SignaturesCard } from '../components/SignaturesCard';
import { SyncCard } from '../components/SyncCard';
import { DocThemePicker } from '../components/DocThemePicker';
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

  const presetLabels: Record<PresetKind, string> = {
    staff: t.presetStaff,
    role: t.presetRole,
    trade: t.presetTrade,
    equipment: t.presetEquipment,
    weather: t.presetWeather,
    concreteType: t.presetConcrete,
  };

  const themeOptions: { value: ThemePreference; label: string; hint: string }[] = [
    { value: 'light', label: t.themeLight, hint: t.themeLightHint },
    { value: 'dark', label: t.themeDark, hint: t.themeDarkHint },
    { value: 'auto', label: t.themeAuto, hint: t.themeAutoHint },
  ];
  const companyLogo = useCompanyLogo();
  const docThemeId = useDocThemeId();
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
      await saveBlob(
        new Blob([json], { type: 'application/json' }),
        `${t.fileBackupPrefix}-${isoDate()}.json`,
      );
      toast.show(t.backupDownloaded);
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
      await saveBlob(result.blob, result.name);
      toast.show(t.exportAllDone(result.entries, result.projects));
    } catch (error) {
      const empty = error instanceof Error && error.message === 'EMPTY';
      toast.error(empty ? t.exportAllEmpty : t.exportAllFailed);
    } finally {
      setBusy(false);
      setExportAll(null);
    }
  };

  const restore = async (file: File) => {
    if (
      !window.confirm(t.confirmRestore)
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await restoreFromJson(await file.text());
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
              <span>{option.label}</span>
              <span className="segmented__hint">{option.hint}</span>
            </button>
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
        <div className="btn-row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void backup()}
          >
            ⬇ {t.downloadBackup}
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
              : `🗂 ${t.exportAll}`}
          </button>
          <label className="btn">
            ⬆ {t.restoreBackup}
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
                      ✕
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
