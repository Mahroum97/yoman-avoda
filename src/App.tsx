/** Shell, routing and the "no project yet" onboarding path. */
import { useEffect, useMemo, useState } from 'react';
import { dbHealth, onDbHealth, type DbHealth } from './db';
import { useActiveProject, useProjects } from './hooks/useData';
import { useRoute, navigate } from './hooks/useRoute';
import { ToastProvider } from './components/ToastProvider';
import { useToast } from './hooks/toastContext';
import { EntriesScreen } from './screens/EntriesScreen';
import { EntryEditor } from './screens/EntryEditor';
import { PreviewScreen } from './screens/PreviewScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { ContactsScreen } from './screens/ContactsScreen';
import { TrashScreen } from './screens/TrashScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { ReportPreviewScreen } from './screens/ReportPreviewScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { EmptyState } from './components/ui';
import { Icon, type IconName } from './components/Icon';
import { Logo } from './components/Logo';
import { useTheme, type ThemePreference } from './hooks/useTheme';
import { useLanguage } from './i18n/useLanguage';
import type { Strings } from './i18n/strings';
import { useAutoSync } from './hooks/useAutoSync';
import { UndoButtons } from './components/UndoButtons';
import {
  EditorActionsContext,
  type EditorActions,
} from './hooks/editorActionsContext';

const TAB_KEYS = ['', 'reports', 'projects', 'contacts', 'settings'] as const;
const TAB_ICONS: IconName[] = ['diary', 'reports', 'projects', 'contacts', 'settings'];

/** Sections that work with no project at all, and so escape the onboarding redirect. */
const PROJECTLESS = new Set(['projects', 'settings', 'contacts', 'trash']);

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const { t } = useLanguage();
  const toast = useToast();
  const route = useRoute();
  const projects = useProjects();
  const { project, loading } = useActiveProject();
  const section = route.segments[0] ?? '';

  // Undo and redo live in the bar above, but the history belongs to whichever
  // screen is being edited. It publishes here and the bar reads it.
  const [editorActions, setEditorActions] = useState<EditorActions | null>(null);
  const registry = useMemo(
    () => ({ actions: editorActions, publish: setEditorActions }),
    [editorActions],
  );

  // Mounted once, for the whole app: the diary keeps itself current while it is
  // open, and only speaks up when something actually arrived.
  useAutoSync((received) => {
    if (received > 0) toast.show(t.syncAutoReceived(received));
  });

  // A first run has no project, and the diary screens need one. Settings stays
  // reachable regardless — restoring a backup onto a new device starts there —
  // and so does the address book, which belongs to the person rather than to
  // any one site and is worth filling in before the first job exists.
  useEffect(() => {
    if (loading || !projects) return;
    if (projects.length === 0 && !PROJECTLESS.has(section)) {
      navigate('/projects');
    }
  }, [loading, projects, section]);

  const isPreview = section === 'preview';

  return (
    <EditorActionsContext.Provider value={registry}>
    <div className="app">
      {!isPreview && (
        <header className="topbar">
          <Logo size={30} />
          <div className="topbar__grow">
            <div className="topbar__title">{t.appName}</div>
            {project && <div className="topbar__sub">{project.name}</div>}
          </div>
          <UndoButtons />
          <BackupButton />
          <ThemeButton />
        </header>
      )}

      <main className="main">
        <Screen
          section={section}
          route={route}
          project={project}
          ready={!loading && !!projects}
          hasProjects={(projects?.length ?? 0) > 0}
        />
      </main>

      {!isPreview && (
        <nav className="nav" aria-label={t.appName}>
          {TAB_KEYS.map((key, i) => (
            <button
              key={key}
              type="button"
              className="nav__item"
              aria-current={section === key ? 'page' : undefined}
              onClick={() => navigate(`/${key}`)}
            >
              <span className="nav__icon">
                <Icon name={TAB_ICONS[i]} size={23} />
              </span>
              <span>
                {[t.navDiary, t.navReports, t.navProjects, t.navContacts, t.navSettings][i]}
              </span>
            </button>
          ))}
          <button
            type="button"
            className="nav__item"
            onClick={() => navigate('/entry/new')}
            disabled={!project}
          >
            <span className="nav__icon">
              <Icon name="plus" size={23} />
            </span>
            <span>{t.navNew}</span>
          </button>
        </nav>
      )}
    </div>
    </EditorActionsContext.Provider>
  );
}

/**
 * Backup, one tap, from wherever you are in the app.
 *
 * It sits in the bar rather than only in Settings because of what it is for: the
 * moment you want to know your work is safe is the moment you have just written
 * something, not a moment you are willing to go looking through settings for.
 *
 * On a device that can write a copy by itself it writes one. On a browser,
 * which cannot, it falls back to the ordinary export — so the button always
 * does the most this device is capable of rather than being disabled and
 * explaining why.
 */
function BackupButton() {
  const { t } = useLanguage();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const { lastBackupAt, STALE_MS } = await import('./lib/autoBackup');
      const at = lastBackupAt();
      if (!cancelled) setStale(at === null || Date.now() - at > STALE_MS);
    };
    void check();
    // Re-read rather than trusting one reading: the automatic backup runs a few
    // seconds after launch, behind this button.
    const timer = window.setInterval(check, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { backupNow, lastBackupAt, STALE_MS } = await import('./lib/autoBackup');
      // Forced: a button press is an instruction, not a suggestion — skipping
      // it because nothing changed would look like the button doing nothing.
      const where = await backupNow({ force: true });
      if (where) {
        toast.show(t.backupSaved(where));
      } else {
        // Nowhere to write on its own — hand the file to the user instead.
        const { backupToJson } = await import('./db');
        const { saveBlob } = await import('./lib/save');
        const name = `${t.fileBackupPrefix}-${new Date().toISOString().slice(0, 10)}.json`;
        const saved = await saveBlob(
          new Blob([await backupToJson()], { type: 'application/json' }),
          name,
        );
        if (saved) toast.show(t.backupDownloaded);
      }
      const at = lastBackupAt();
      setStale(at === null || Date.now() - at > STALE_MS);
    } catch {
      toast.error(t.backupFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="topbar__icon topbar__icon--backup"
      data-stale={stale || undefined}
      onClick={() => void run()}
      disabled={busy}
      title={t.backupNowAction}
      aria-label={t.backupNowAction}
    >
      <Icon name="backup" size={19} />
    </button>
  );
}

const THEME_ICONS: Record<ThemePreference, IconName> = {
  light: 'sun',
  dark: 'moon',
  black: 'black',
  auto: 'auto',
};

const THEME_LABELS: Record<ThemePreference, keyof Strings> = {
  light: 'themeLight',
  dark: 'themeDark',
  black: 'themeBlack',
  auto: 'themeAuto',
};

/**
 * One tap moves to the next display mode, and the button shows which one is on.
 *
 * `data-theme` on the button itself is what lets it be styled per mode: on the
 * black theme it has to lose the pale tint it wears on the others, or it sits
 * on a pure-black bar looking like a leftover from a different app.
 */
function ThemeButton() {
  const { preference, cycle } = useTheme();
  const { t } = useLanguage();
  const label = `${t.display}: ${t[THEME_LABELS[preference]] as string}`;
  return (
    <button
      type="button"
      className="topbar__icon topbar__icon--theme"
      data-mode={preference}
      onClick={cycle}
      title={label}
      aria-label={label}
    >
      <Icon name={THEME_ICONS[preference]} size={19} />
    </button>
  );
}

function Screen({
  section,
  route,
  project,
  ready,
  hasProjects,
}: {
  section: string;
  route: ReturnType<typeof useRoute>;
  project: ReturnType<typeof useActiveProject>['project'];
  ready: boolean;
  hasProjects: boolean;
}) {
  if (!ready) return <Loading />;

  if (section === 'projects') {
    return <ProjectsScreen activeId={project?.id} />;
  }

  if (section === 'settings') {
    return <SettingsScreen />;
  }

  // Before the project guard: the address book needs no site.
  if (section === 'contacts') {
    return <ContactsScreen />;
  }

  // Also before it: a diary with every page in the trash still has a trash.
  if (section === 'trash') {
    return <TrashScreen project={project} />;
  }

  if (!hasProjects || !project) {
    return (
      <StartHere />
    );
  }

  if (section === 'reports') {
    return <ReportsScreen project={project} />;
  }

  if (section === 'entry') {
    const target = route.segments[1];
    if (!target || target === 'new') {
      return (
        <EntryEditor project={project} initialDate={route.query.get('date') ?? undefined} />
      );
    }
    const id = Number(target);
    if (Number.isNaN(id)) return <NotFound />;
    return <EntryEditor entryId={id} project={project} />;
  }

  if (section === 'report-preview') {
    const from = route.query.get('from');
    const to = route.query.get('to');
    if (!from || !to) return <NotFound />;
    return (
      <ReportPreviewScreen
        project={project}
        from={from}
        to={to}
        includePhotos={route.query.get('photos') === '1'}
        includeSummary={route.query.get('summary') === '1'}
      />
    );
  }

  if (section === 'preview') {
    const id = Number(route.segments[1]);
    if (Number.isNaN(id)) return <NotFound />;
    return <PreviewScreen entryId={id} project={project} />;
  }

  return <EntriesScreen project={project} />;
}

/**
 * "Loading" — until it becomes clear that it is not loading at all.
 *
 * A diary held open by another copy of the app never resolves and never fails,
 * so this line used to sit on screen indefinitely. After that it says what is
 * actually wrong and what to do about it, which is the whole difference between
 * a bug report of "it doesn't work" and one that can be acted on.
 */
function Loading() {
  const { t } = useLanguage();
  const [health, setHealth] = useState<DbHealth>(dbHealth);
  useEffect(() => onDbHealth(setHealth), []);

  if (health === 'stuck' || health === 'failed') {
    return (
      <EmptyState icon="warning" title={t.dbStuckTitle}>
        <p className="muted" style={{ marginBottom: 16 }}>
          {health === 'stuck' ? t.dbStuckBody : t.dbFailedBody}
        </p>
        <button type="button" className="btn btn--primary" onClick={() => location.reload()}>
          {t.dbRetry}
        </button>
      </EmptyState>
    );
  }

  return <p className="muted">{t.loading}</p>;
}

function NotFound() {
  return <EmptyState icon="warning" title="404" />;
}

function StartHere() {
  const { t } = useLanguage();
  return (
    <EmptyState icon="projects" title={t.startTitle}>
      <p className="muted" style={{ marginBottom: 16 }}>
        {t.startBody}
      </p>
      <button type="button" className="btn btn--primary" onClick={() => navigate('/projects')}>
        {t.startAction}
      </button>
    </EmptyState>
  );
}
