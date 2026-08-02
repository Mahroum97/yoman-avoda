/**
 * Undo and redo, as they appear in the app bar.
 *
 * They are only rendered while a screen has published a history to step
 * through — see `editorActionsContext`.
 */
import { useLanguage } from '../i18n/useLanguage';
import { useEditorActions } from '../hooks/editorActionsContext';

/**
 * The undo arrow, mirrored for redo.
 *
 * Drawn rather than typed: the ↶/↷ characters come out as hairlines at button
 * size in the system fonts, and unreadable on a phone in daylight. It does
 * *not* flip with the writing direction — the curl-to-the-left undo arrow is
 * the same in every app on every platform, and recognising it at a glance
 * matters more here than agreeing with the text beside it.
 */
export function UndoIcon({ forward = false }: { forward?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={forward ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a5.5 5.5 0 0 1 0 11h-3" />
    </svg>
  );
}

export function UndoButtons() {
  const { t } = useLanguage();
  const { actions } = useEditorActions();
  if (!actions) return null;

  return (
    <div className="topbar__undo">
      <button
        type="button"
        className="topbar__icon"
        disabled={!actions.canUndo}
        aria-label={t.undoEdit}
        title={t.undoEdit}
        onClick={actions.undo}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        className="topbar__icon"
        disabled={!actions.canRedo}
        aria-label={t.redoEdit}
        title={t.redoEdit}
        onClick={actions.redo}
      >
        <UndoIcon forward />
      </button>
    </div>
  );
}
