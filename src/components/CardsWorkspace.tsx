import { useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DiaryEntry, Project } from '../types';
import { db, statusFor } from '../db';
import { useLanguage } from '../i18n/useLanguage';
import { formatDdMmYyyy } from '../lib/dates';
import { photoPageCount } from '../lib/photoPages';
import { useDocThemeId } from '../hooks/useDocTheme';
import { navigate } from '../hooks/useRoute';
import { useWideScreen } from '../hooks/useWideScreen';
import { SheetPreview } from './SheetPreview';
import { SheetScaler } from './SheetScaler';
import { Icon } from './Icon';
import '../styles/cardsWorkspace.css';

/** A bounded diary rail; a hidden mobile sidebar must not deserialize photos. */
export function CardsDayNavigation({ projectId, entryId }: { projectId?: number; entryId?: number }) {
  const wide = useWideScreen(1100);
  const { t } = useLanguage();
  const entries = useLiveQuery(async () => {
    if (!wide || projectId === undefined) return [];
    const rows = await db.entries.where('[projectId+date]')
      .between([projectId, ''], [projectId, '\uffff'])
      .reverse().filter(entry => entry.deletedAt === undefined).limit(14).toArray();
    return rows.map(entry => ({ id: entry.id!, date: entry.date, status: statusFor(entry) }));
  }, [wide, projectId]);
  if (!wide || !entries?.length) return null;
  return (
    <section className="cards-day-navigation" aria-label={t.cardsRecentDays}>
      <h2>{t.cardsRecentDays}</h2>
      <div className="cards-day-list">
        {entries.map(entry => <button key={entry.id} type="button" className="cards-day-item"
          aria-current={entryId === entry.id ? 'page' : undefined}
          onClick={() => navigate(`/entry/${entry.id}`)}>
          <bdi dir="ltr">{formatDdMmYyyy(entry.date)}</bdi>
          <span className={entry.status === 'signed' ? 'cards-day-status cards-day-status--signed' : 'cards-day-status'}>
            {entry.status === 'signed' && <Icon name="check" size={13} />}
            {entry.status === 'signed' ? t.statusSigned : t.statusDraft}
          </span>
        </button>)}
      </div>
    </section>
  );
}

/** The real shared A4 renderer follows the current draft; no fourth renderer. */
export function CardsEditorLayout({ children, entry, project, companyLogo }: {
  children: ReactNode; entry: DiaryEntry; project: Project; companyLogo?: string;
}) {
  const wide = useWideScreen(1200);
  const deferred = useDeferredValue(entry);
  const { t } = useLanguage();
  const themeId = useDocThemeId();
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (wide && expanded && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
    }
  }, [wide, expanded]);
  useEffect(() => { if (!wide) setExpanded(false); }, [wide]);

  const preview = () => <SheetScaler><SheetPreview entry={deferred} project={project}
    companyLogo={companyLogo} pages={1 + photoPageCount(deferred.photos?.length ?? 0)} themeId={themeId} /></SheetScaler>;

  return (
    <div className="cards-editor-shell">
      <CardsDayNavigation projectId={project.id} entryId={entry.id} />
      <div className="cards-editor-grid">
      <div className="cards-editor-form">{children}</div>
      {wide && <aside className="cards-editor-preview" aria-label={t.cardsLivePreview}>
        <header className="cards-editor-preview__head">
          <div><h2>{t.cardsLivePreview}</h2><span className="muted small">{t.cardsPreviewHint}</span></div>
          <button type="button" className="btn btn--sm" onClick={() => setExpanded(true)}><Icon name="eye" size={17} />{t.cardsExpandPreview}</button>
        </header>
        <div className="cards-editor-preview__body" aria-busy={deferred !== entry}>{preview()}</div>
      </aside>}
      {wide && expanded && <dialog className="cards-document-dialog" ref={dialog} onClose={() => setExpanded(false)}
        onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
        <header className="cards-document-dialog__head">
          <h2>{t.cardsLivePreview}</h2>
          <button type="button" className="btn" autoFocus onClick={() => dialog.current?.close()}>{t.back}</button>
        </header>
        {preview()}
      </dialog>}
      </div>
    </div>
  );
}
