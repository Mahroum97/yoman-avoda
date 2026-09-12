/** Sites the diary is kept for. The active one heads every exported page. */
import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { createProject, db, deleteProject, updateProject } from '../db';
import { useProjects, setActiveProject } from '../hooks/useData';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { navigate } from '../hooks/useRoute';
import { Card, EmptyState, Field, Modal } from '../components/ui';
import { Icon } from '../components/Icon';
import { logger } from '../lib/log';

const EMPTY = { name: '', address: '', company: '' };
const log = logger('projects-screen');

export function ProjectsScreen({ activeId, createRequested = false, afterCreate }: {
  activeId?: number; createRequested?: boolean; afterCreate?: string;
}) {
  const projects = useProjects();
  const toast = useToast();
  const { t } = useLanguage();
  const [draft, setDraft] = useState<typeof EMPTY | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // State disables the controls after render; the ref closes the same-tick
  // window in which a double tap can dispatch two creates before that render.
  const inFlight = useRef<string | null>(null);

  const begin = (operation: string) => {
    if (inFlight.current !== null) return false;
    inFlight.current = operation;
    setBusy(operation);
    return true;
  };

  const finish = () => {
    inFlight.current = null;
    setBusy(null);
  };

  useEffect(() => {
    if (createRequested) setDraft(EMPTY);
  }, [createRequested]);

  const save = async () => {
    if (!draft?.name.trim()) {
      toast.error(t.projectNameRequired);
      return;
    }
    if (!begin('create')) return;
    let id: number;
    try {
      id = await createProject({
        name: draft.name.trim(),
        address: draft.address.trim(),
        company: draft.company.trim(),
      });
    } catch (error) {
      log.error('project creation failed', error);
      toast.error(t.projectSaveFailed);
      finish();
      return;
    }

    // Creation is already committed. Close the form before the optional
    // activation so retrying a failed follow-up cannot create a duplicate.
    setDraft(null);
    toast.show(t.projectAdded);
    try {
      if (afterCreate) {
        await setActiveProject(id);
        navigate(afterCreate);
      }
    } catch (error) {
      log.error('new project activation failed', error);
      toast.error(t.projectSwitchFailed);
    } finally {
      finish();
    }
  };

  const update = async () => {
    if (!editing?.id) return;
    if (!editing.name.trim()) {
      toast.error(t.projectNameRequired);
      return;
    }
    if (!begin(`update:${editing.id}`)) return;
    try {
      await updateProject(editing.id, {
        name: editing.name.trim(),
        address: editing.address.trim(),
        company: editing.company.trim(),
      });
      setEditing(null);
      toast.show(t.projectUpdated);
    } catch (error) {
      log.error('project update failed', error);
      toast.error(t.projectSaveFailed);
    } finally {
      finish();
    }
  };

  const remove = async (project: Project) => {
    if (project.id === undefined || !begin(`delete:${project.id}`)) return;
    try {
      const count = await db.entries.where('projectId').equals(project.id).count();
      if (!window.confirm(t.confirmDeleteProject(project.name, count))) return;
      await deleteProject(project.id);
      toast.show(t.projectDeleted);
    } catch (error) {
      log.error('project deletion failed', error);
      toast.error(t.projectDeleteFailed);
    } finally {
      finish();
    }
  };

  const activate = async (project: Project) => {
    if (project.id === undefined || !begin(`switch:${project.id}`)) return;
    try {
      await setActiveProject(project.id);
      toast.show(t.switchedTo(project.name));
      navigate('/');
    } catch (error) {
      log.error('active project switch failed', error);
      toast.error(t.projectSwitchFailed);
    } finally {
      finish();
    }
  };

  if (!projects) return <p className="muted">{t.loading}</p>;

  return (
    <div>
      <div className="row row--wrap" style={{ marginBottom: 16 }}>
        <h1 className="grow">{t.projectsTitle}</h1>
        <button type="button" className="btn btn--primary" disabled={busy !== null} onClick={() => setDraft(EMPTY)}>
          <Icon name="plus" size={17} />
          {t.newProject}
        </button>
      </div>

      {projects.length === 0 && (
        <EmptyState icon="projects" title={t.noProjectsTitle}>
          <p className="muted" style={{ marginBottom: 16 }}>
            {t.noProjectsBody}
          </p>
          <button type="button" className="btn" onClick={() => navigate('/settings')}>
            {t.restoreInstead}
          </button>
        </EmptyState>
      )}

      {projects.map((project) => (
        <Card key={project.id}>
          <div className="row row--wrap">
            <div className="grow">
              <h2>{project.name}</h2>
              <p className="muted small">
                {[project.address, project.company].filter(Boolean).join(' · ') || '—'}
              </p>
            </div>
            {project.id === activeId ? (
              <span className="chip chip--ok">{t.activeProject}</span>
            ) : (
              <button
                type="button"
                className="btn btn--sm"
                disabled={busy !== null}
                onClick={() => void activate(project)}
              >
                {busy === `switch:${project.id}` ? t.working : t.makeActive}
              </button>
            )}
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn--sm"
              disabled={busy !== null}
              onClick={() => setEditing({ ...project })}
            >
              {t.editDetails}
            </button>
            <button
              type="button"
              className="btn btn--sm btn--danger"
              disabled={busy !== null}
              onClick={() => void remove(project)}
            >
              {busy === `delete:${project.id}` ? t.working : t.delete}
            </button>
          </div>
        </Card>
      ))}

      {draft && (
        <Modal title={t.newProject} onClose={() => { if (busy === null) setDraft(null); }}>
          <ProjectForm value={draft} onChange={setDraft} disabled={busy !== null} />
          <div className="btn-row btn-row--end">
            <button type="button" className="btn" disabled={busy !== null} onClick={() => setDraft(null)}>
              {t.cancel}
            </button>
            <button type="button" className="btn btn--primary" disabled={busy !== null} onClick={() => void save()}>
              {busy === 'create' ? t.savingNote : t.save}
            </button>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title={t.editDetails} onClose={() => { if (busy === null) setEditing(null); }}>
          <ProjectForm
            value={editing}
            onChange={(value) => setEditing({ ...editing, ...value })}
            disabled={busy !== null}
          />
          <div className="btn-row btn-row--end">
            <button type="button" className="btn" disabled={busy !== null} onClick={() => setEditing(null)}>
              {t.cancel}
            </button>
            <button type="button" className="btn btn--primary" disabled={busy !== null} onClick={() => void update()}>
              {busy?.startsWith('update:') ? t.savingNote : t.update}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ProjectForm({
  value,
  onChange,
  disabled = false,
}: {
  value: { name: string; address: string; company: string };
  onChange: (value: { name: string; address: string; company: string }) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <>
      <Field label={t.labelProjectName}>
        <input
          type="text"
          disabled={disabled}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder={t.phProjectName}
        />
      </Field>
      <Field label={t.labelAddress}>
        <input
          type="text"
          disabled={disabled}
          value={value.address}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
          placeholder={t.phAddress}
        />
      </Field>
      <Field label={t.labelCompany}>
        <input
          type="text"
          disabled={disabled}
          value={value.company}
          onChange={(e) => onChange({ ...value, company: e.target.value })}
          placeholder={t.phCompany}
        />
      </Field>
    </>
  );
}
