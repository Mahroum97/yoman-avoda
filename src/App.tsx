/** Shell, routing and the "no project yet" onboarding path. */
import { useEffect } from 'react';
import { useActiveProject, useProjects } from './hooks/useData';
import { useRoute, navigate } from './hooks/useRoute';
import { ToastProvider } from './components/ToastProvider';
import { useToast } from './hooks/toastContext';
import { EntriesScreen } from './screens/EntriesScreen';
import { EntryEditor } from './screens/EntryEditor';
import { PreviewScreen } from './screens/PreviewScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { EmptyState } from './components/ui';
import { Logo } from './components/Logo';
import { useTheme, type ThemePreference } from './hooks/useTheme';
import { useLanguage } from './i18n/useLanguage';
import { useAutoSync } from './hooks/useAutoSync';

const TAB_KEYS = ['', 'reports', 'projects', 'settings'] as const;
const TAB_ICONS = ['📋', '📊', '🏗️', '⚙️'];

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

  // Mounted once, for the whole app: the diary keeps itself current while it is
  // open, and only speaks up when something actually arrived.
  useAutoSync((received) => {
    if (received > 0) toast.show(t.syncAutoReceived(received));
  });

  // A first run has no project, and the diary screens need one. Settings stays
  // reachable regardless — restoring a backup onto a new device starts there.
  useEffect(() => {
    if (loading || !projects) return;
    if (projects.length === 0 && section !== 'projects' && section !== 'settings') {
      navigate('/projects');
    }
  }, [loading, projects, section]);

  const isPreview = section === 'preview';

  return (
    <div className="app">
      {!isPreview && (
        <header className="topbar">
          <Logo size={30} />
          <div className="topbar__grow">
            <div className="topbar__title">{t.appName}</div>
            {project && <div className="topbar__sub">{project.name}</div>}
          </div>
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
                {[t.navDiary, t.navReports, t.navProjects, t.navSettings][i]}
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

  if (section === 'preview') {
    const id = Number(route.segments[1]);
    if (Number.isNaN(id)) return <NotFound />;
    return <PreviewScreen entryId={id} project={project} />;
  }

  return <EntriesScreen project={project} />;
}

function Loading() {
  const { t } = useLanguage();
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
