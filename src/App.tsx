/** Shell, routing and the visible "no project yet" setup path. */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  dbHealth,
  EntryDateConflictError,
  onDbHealth,
  restoreFromTrash,
  type DbHealth,
} from './db';
import {
  useActiveProject,
  useProjects,
  useRoutedEntry,
  type RoutedEntryState,
} from './hooks/useData';
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
import { useTheme } from './hooks/useTheme';
import { useLanguage } from './i18n/useLanguage';
import { useAutoSync } from './hooks/useAutoSync';
import { UndoButtons } from './components/UndoButtons';
import { PageActionsBar } from './components/PageActions';
import { CardsDayNavigation } from './components/CardsWorkspace';
import { useShortcuts, type ShellHandlers } from './hooks/useShortcuts';
import {
  EditorActionsContext,
  type EditorActions,
  type PageActions,
} from './hooks/editorActionsContext';

const TAB_KEYS = ['', 'reports', 'entry-new', 'projects', 'contacts'] as const;
const TAB_ICONS: IconName[] = ['diary', 'reports', 'plus', 'projects', 'contacts'];

/** Setup can return only to one of the screens that needs a project. */
const SETUP_DESTINATIONS = new Set(['/', '/reports', '/entry/new']);

function routedEntryId(section: string, target?: string): number | undefined {
  if (section !== 'preview' && (section !== 'entry' || !target || target === 'new')) {
    return undefined;
  }
  const id = Number(target);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

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
  const { project: activeProject, loading } = useActiveProject();
  const { cycle: cycleTheme } = useTheme();
  const section = route.segments[0] ?? '';
  const routeEntryId = routedEntryId(section, route.segments[1]);
  const routeEntry = useRoutedEntry(routeEntryId);
  const hasEntryTarget = section === 'preview' ||
    (section === 'entry' && route.segments[1] !== undefined && route.segments[1] !== 'new');
  // A routed day carries its own project context. While it resolves (or if it
  // is broken), showing the active project's name would recreate the exact
  // false pairing this route validation exists to prevent.
  const project = hasEntryTarget
    ? routeEntry.kind === 'found' || routeEntry.kind === 'deleted'
      ? routeEntry.project
      : undefined
    : activeProject;

  // Undo and redo live in the bar above, but the history belongs to whichever
  // screen is being edited. It publishes here and the bar reads it.
  const [editorActions, setEditorActions] = useState<EditorActions | null>(null);
  // And beside them, whatever else the screen can do — save, export, delete.
  const [pageActions, setPageActions] = useState<PageActions | null>(null);
  const registry = useMemo(
    () => ({
      actions: editorActions,
      publish: setEditorActions,
      page: pageActions,
      publishPage: setPageActions,
    }),
    [editorActions, pageActions],
  );

  /* Backup and the keyboard-only theme shortcut are owned by the shell. */
  const shell = useRef<ShellHandlers>({});
  shell.current.theme = cycleTheme;
  useShortcuts(pageActions, editorActions, shell);

  // Mounted once, for the whole app: the diary keeps itself current while it is
  // open, and only speaks up when something actually arrived.
  useAutoSync((received) => {
    if (received > 0) toast.show(t.syncAutoReceived(received));
  });

  // Empty installations still respond to every tab. Screen explains the
  // missing project on the requested page instead of silently bouncing back.

  const isPreview = section === 'preview';
  const chrome = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = chrome.current;
    if (!element) return;
    const measure = () => document.documentElement.style.setProperty(
      '--chrome-height', `${element.getBoundingClientRect().height}px`,
    );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--chrome-height');
    };
  }, [isPreview]);

  return (
    <EditorActionsContext.Provider value={registry}>
    <div className={`app app--cards${isPreview ? ' app--preview' : ''}`} data-section={section}>
      {!isPreview && (
        <aside className="cards-sidebar">
          <div className="cards-sidebar__brand">
            <Logo size={28} />
            <span>{t.appName}</span>
          </div>
          <nav className="nav" aria-label={t.appName}>
            {TAB_KEYS.map((key, i) => (
              <button
                key={key}
                type="button"
                className={`nav__item${key === 'entry-new' ? ' nav__item--new' : ''}`}
                aria-current={key === 'entry-new'
                  ? section === 'entry' && route.segments[1] === 'new' ? 'page' : undefined
                  : section === key ? 'page' : undefined}
                onClick={() => navigate(key === 'entry-new' ? '/entry/new' : `/${key}`)}
              >
                <span className="nav__icon">
                  <Icon name={TAB_ICONS[i]} size={23} />
                </span>
                <span>
                  {[t.navDiary, t.navReports, t.navNew, t.navProjects, t.navContacts][i]}
                </span>
              </button>
            ))}
          </nav>
          <CardsDayNavigation projectId={project?.id} entryId={routeEntryId} />
        </aside>
      )}
      <div className="cards-content">
      {/*
        One sticky element holds both bars, and that is load-bearing twice over.
        Sticking them separately at `top: 0` makes them pile on top of each other
        the moment the page scrolls; and a menu opening out of the lower bar
        cannot escape that bar's own stacking context, so it was painting behind
        the form underneath it. One container, one context, no overlap.
      */}
      {!isPreview && (
        <div className="chrome" ref={chrome}>
          <header className="topbar">
            <button
              type="button"
              className="topbar__icon topbar__icon--settings"
              aria-current={section === 'settings' ? 'page' : undefined}
              onClick={() => navigate('/settings')}
              title={t.navSettings}
              aria-label={t.navSettings}
            >
              <Icon name="settings" size={20} />
            </button>
            <span className="topbar__logo"><Logo size={30} /></span>
            <div className={`topbar__grow${project ? '' : ' topbar__grow--app'}`} dir={t.dir}>
              <div className="topbar__title">{project ? project.name : t.appName}</div>
              {project?.address && <div className="topbar__sub">{project.address}</div>}
            </div>
            <UndoButtons />
            <BackupButton shell={shell} />
          </header>
          {/* Renders nothing at all when the screen has published no actions. */}
          <PageActionsBar />
        </div>
      )}

      <main className="main">
        <Screen
          section={section}
          route={route}
          project={activeProject}
          routeEntry={routeEntry}
          ready={!loading && !!projects}
          hasProjects={(projects?.length ?? 0) > 0}
        />
      </main>
      </div>
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
function BackupButton({ shell }: { shell: React.RefObject<ShellHandlers> }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);

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
    if (inFlight.current) return;
    inFlight.current = true;
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
      inFlight.current = false;
      setBusy(false);
    }
  };

  // Filled during render, not in an effect: `run` is rebuilt every render and
  // the slot has to hold the current one, not the one from mount.
  shell.current.backup = () => void run();

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

function Screen({
  section,
  route,
  project,
  routeEntry,
  ready,
  hasProjects,
}: {
  section: string;
  route: ReturnType<typeof useRoute>;
  project: ReturnType<typeof useActiveProject>['project'];
  routeEntry: RoutedEntryState;
  ready: boolean;
  hasProjects: boolean;
}) {
  if (!ready) return <Loading />;

  if (section === 'projects') {
    const next = route.query.get('next');
    return <ProjectsScreen activeId={project?.id}
      createRequested={route.query.get('create') === '1'}
      afterCreate={next && SETUP_DESTINATIONS.has(next) ? next : undefined} />;
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

  // Existing-day routes resolve their own owner before the active-project
  // guard. A broken bookmark must say that its day is missing or deleted even
  // on a device whose project list is empty; it must never become setup for a
  // brand-new page.
  if (section === 'entry' && route.segments[1] && route.segments[1] !== 'new') {
    const id = Number(route.segments[1]);
    if (!Number.isSafeInteger(id) || id <= 0) return <NotFound />;
    if (routeEntry.kind === 'loading' || routeEntry.kind === 'idle') return <Loading />;
    if (routeEntry.kind !== 'found') return <EntryRouteRecovery state={routeEntry} />;
    return <EntryEditor key={routeEntry.entry.uid} entryId={id} project={routeEntry.project} />;
  }

  if (section === 'preview') {
    const id = Number(route.segments[1]);
    if (!Number.isSafeInteger(id) || id <= 0) return <NotFound />;
    if (routeEntry.kind === 'loading' || routeEntry.kind === 'idle') return <Loading />;
    if (routeEntry.kind !== 'found') return <EntryRouteRecovery state={routeEntry} />;
    return <PreviewScreen entry={routeEntry.entry} project={routeEntry.project} />;
  }

  if (!hasProjects || !project) {
    return (
      <StartHere section={section} hasProjects={hasProjects} />
    );
  }

  if (section === 'reports') {
    return <ReportsScreen project={project} />;
  }

  if (section === 'entry') {
    const target = route.segments[1];
    if (!target || target === 'new') {
      return (
        <EntryEditor key={`${project.uid}:new:${route.navigationId}`} project={project} initialDate={route.query.get('date') ?? undefined} />
      );
    }
    return <NotFound />;
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

function StartHere({ section, hasProjects }: { section: string; hasProjects: boolean }) {
  const { t } = useLanguage();
  const reports = section === 'reports' || section === 'report-preview';
  const newEntry = section === 'entry';
  const destination = reports ? '/reports' : newEntry ? '/entry/new' : '/';
  const title = reports ? t.navReports : newEntry ? t.navNew : t.navDiary;
  const body = hasProjects ? t.setupChooseProjectBody
    : reports ? t.setupReportsBody : newEntry ? t.setupNewBody : t.setupDiaryBody;
  return (
    <div className="project-setup">
      <h1 className="screen-title">{title}</h1>
      <EmptyState icon={reports ? 'reports' : newEntry ? 'plus' : 'diary'}
        title={hasProjects ? t.startAction : t.noProjectsTitle}>
        <p className="muted" style={{ marginBottom: 16 }}>{body}</p>
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn--primary" onClick={() => navigate(
            hasProjects ? '/projects' : `/projects?create=1&next=${encodeURIComponent(destination)}`,
          )}>
            {hasProjects ? t.startAction : t.newProject}
          </button>
          {!hasProjects && <button type="button" className="btn" onClick={() => navigate('/settings')}>
            {t.restoreInstead}
          </button>}
        </div>
      </EmptyState>
    </div>
  );
}

function EntryRouteRecovery({ state }: { state: Exclude<RoutedEntryState, { kind: 'found' | 'loading' | 'idle' }> }) {
  const { t } = useLanguage();
  const toast = useToast();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  const restore = async () => {
    if (state.kind !== 'deleted' || state.entry.id === undefined || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await restoreFromTrash(state.entry.id);
      toast.show(t.trashRestored(1));
    } catch (error) {
      toast.error(error instanceof EntryDateConflictError ? t.trashClash : t.entryRestoreFailed);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const title = state.kind === 'deleted'
    ? t.entryInTrashTitle
    : state.kind === 'orphaned'
      ? t.entryOwnerMissingTitle
      : t.entryMissingTitle;
  const body = state.kind === 'deleted'
    ? t.entryInTrashBody
    : state.kind === 'orphaned'
      ? t.entryOwnerMissingBody
      : t.entryMissingBody;

  return (
    <EmptyState icon={state.kind === 'deleted' ? 'trash' : 'warning'} title={title}>
      <p className="muted" style={{ marginBottom: 16 }}>{body}</p>
      <div className="btn-row" style={{ justifyContent: 'center' }}>
        {state.kind === 'deleted' && (
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void restore()}>
            {busy ? t.working : t.trashRestore}
          </button>
        )}
        <button type="button" className="btn" disabled={busy} onClick={() => navigate('/')}>
          {t.backToDiary}
        </button>
      </div>
    </EmptyState>
  );
}
