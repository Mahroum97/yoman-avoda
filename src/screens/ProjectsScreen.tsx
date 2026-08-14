/** Sites the diary is kept for. The active one heads every exported page. */
import { useState } from 'react';
import type { Project } from '../types';
import { createProject, db, deleteProject } from '../db';
import { useProjects, setActiveProject } from '../hooks/useData';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { navigate } from '../hooks/useRoute';
import { Card, EmptyState, Field, Modal } from '../components/ui';
import { Icon } from '../components/Icon';

const EMPTY = { name: '', address: '', company: '' };

export function ProjectsScreen({ activeId }: { activeId?: number }) {
  const projects = useProjects();
  const toast = useToast();
  const { t } = useLanguage();
  const [draft, setDraft] = useState<typeof EMPTY | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);

  const save = async () => {
    if (!draft?.name.trim()) {
      toast.error(t.projectNameRequired);
      return;
    }
    await createProject({
      name: draft.name.trim(),
      address: draft.address.trim(),
      company: draft.company.trim(),
    });
    setDraft(null);
    toast.show(t.projectAdded);
  };

  const update = async () => {
    if (!editing?.id) return;
    if (!editing.name.trim()) {
      toast.error(t.projectNameRequired);
      return;
    }
    await db.projects.update(editing.id, {
      name: editing.name.trim(),
      address: editing.address.trim(),
      company: editing.company.trim(),
    });
    setEditing(null);
    toast.show(t.projectUpdated);
  };

  const remove = async (project: Project) => {
    const count = await db.entries.where('projectId').equals(project.id!).count();
    if (!window.confirm(t.confirmDeleteProject(project.name, count))) return;
    await deleteProject(project.id!);
    toast.show(t.projectDeleted);
  };

  if (!projects) return <p className="muted">{t.loading}</p>;

  return (
    <div>
      <div className="row row--wrap" style={{ marginBottom: 16 }}>
        <h1 className="grow">{t.projectsTitle}</h1>
        <button type="button" className="btn btn--primary" onClick={() => setDraft(EMPTY)}>
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
                onClick={async () => {
                  await setActiveProject(project.id!);
                  toast.show(t.switchedTo(project.name));
                  navigate('/');
                }}
              >
                {t.makeActive}
              </button>
            )}
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setEditing({ ...project })}
            >
              {t.editDetails}
            </button>
            <button
              type="button"
              className="btn btn--sm btn--danger"
              onClick={() => void remove(project)}
            >
              {t.delete}
            </button>
          </div>
        </Card>
      ))}

      {draft && (
        <Modal title={t.newProject} onClose={() => setDraft(null)}>
          <ProjectForm value={draft} onChange={setDraft} />
          <div className="btn-row btn-row--end">
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              {t.cancel}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void save()}>
              {t.save}
            </button>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title={t.editDetails} onClose={() => setEditing(null)}>
          <ProjectForm
            value={editing}
            onChange={(value) => setEditing({ ...editing, ...value })}
          />
          <div className="btn-row btn-row--end">
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              {t.cancel}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void update()}>
              {t.update}
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
}: {
  value: { name: string; address: string; company: string };
  onChange: (value: { name: string; address: string; company: string }) => void;
}) {
  const { t } = useLanguage();
  return (
    <>
      <Field label={t.labelProjectName}>
        <input
          type="text"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder={t.phProjectName}
        />
      </Field>
      <Field label={t.labelAddress}>
        <input
          type="text"
          value={value.address}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
          placeholder={t.phAddress}
        />
      </Field>
      <Field label={t.labelCompany}>
        <input
          type="text"
          value={value.company}
          onChange={(e) => onChange({ ...value, company: e.target.value })}
          placeholder={t.phCompany}
        />
      </Field>
    </>
  );
}
