/** Renders the transient status message and supplies the toast API. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ToastContext, type ToastAction, type ToastApi } from '../hooks/toastContext';

interface ToastMessage {
  text: string;
  tone: 'info' | 'error';
  action?: ToastAction;
  key: number;
}

const VISIBLE_MS = 3200;
/**
 * Longer when something can be undone. The countdown is the whole safety net
 * behind a swipe, and three seconds is not enough to read a message, realise it
 * was the wrong day, and reach the button.
 */
const UNDOABLE_MS = 7000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<ToastMessage | null>(null);

  const push = useCallback((text: string, tone: 'info' | 'error', action?: ToastAction) => {
    setMessage({ text, tone, action, key: Date.now() });
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show: (text, action) => push(text, 'info', action),
      error: (text) => push(text, 'error'),
    }),
    [push],
  );

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(
      () => setMessage(null),
      message.action ? UNDOABLE_MS : VISIBLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [message]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {message && (
        <div
          key={message.key}
          className={`toast${message.tone === 'error' ? ' toast--error' : ''}`}
          role="status"
        >
          <span className="toast__text">{message.text}</span>
          {message.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                // Dismissed first: the action usually rewrites the list behind
                // the toast, and leaving the button up invites a second tap
                // that would undo nothing.
                setMessage(null);
                message.action!.run();
              }}
            >
              {message.action.label}
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}
