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
import { ReportsScreen } from './screens/ReportsScreen';
import { ReportPreviewScreen } from './screens/ReportPreviewScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { EmptyState } from './components/ui';
import { Logo } from './components/Logo';
import { useTheme, type ThemePreference } from './hooks/useTheme';
import { useLanguage } from './i18n/useLanguage';
import { useAutoSync } from './hooks/useAutoSync';
import { UndoButtons } from './components/UndoButtons';
import {
  EditorActionsContext,
  type EditorActions,
} from './hooks/editorActionsContext';

const TAB_KEYS = ['', 'reports', 'projects', 'contacts', 'settings'] as const;
const TAB_ICONS = ['📋', '📊', '🏗️', '📇', '⚙️'];

/** Sections that work with no project at all, and so escape the onboarding redirect. */
const PROJECTLESS = new Set(['projects', 'settings', 'contacts']);

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
              <span className="nav__icon" aria-hidden="true">
                {TAB_ICONS[i]}
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
            <span className="nav__icon" aria-hidden="true">
              ＋
            </span>
            <span>{t.navNew}</span>
          </button>
        </nav>
      )}
    </div>
    </EditorActionsContext.Provider>
  );
}

const THEME_ICONS: Record<ThemePreference, string> = {
  light: '☀️',
  dark: '🌙',
  auto: '🌗',
};

function ThemeButton() {
  const { preference, cycle } = useTheme();
  const { t } = useLanguage();
  const label = [t.display, [t.themeLight, t.themeDark, t.themeAuto][
    ['light', 'dark', 'auto'].indexOf(preference)
  ]].join(': ');
  return (
    <button type="button" className="topbar__icon" onClick={cycle} title={label} aria-label={label}>
      <span aria-hidden="true">{THEME_ICONS[preference]}</span>
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
      <EmptyState icon="⚠️" title={t.dbStuckTitle}>
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
  return <EmptyState icon="⚠️" title="404" />;
}

function StartHere() {
  const { t } = useLanguage();
  return (
    <EmptyState icon="🏗️" title={t.startTitle}>
      <p className="muted" style={{ marginBottom: 16 }}>
        {t.startBody}
      </p>
      <button type="button" className="btn btn--primary" onClick={() => navigate('/projects')}>
        {t.startAction}
      </button>
    </EmptyState>
  );
}
