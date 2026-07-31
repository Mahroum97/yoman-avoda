/** Renders the transient status message and supplies the toast API. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ToastContext, type ToastApi } from '../hooks/toastContext';

interface ToastMessage {
  text: string;
  tone: 'info' | 'error';
  key: number;
}

const VISIBLE_MS = 3200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<ToastMessage | null>(null);

  const push = useCallback((text: string, tone: 'info' | 'error') => {
    setMessage({ text, tone, key: Date.now() });
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show: (text) => push(text, 'info'),
      error: (text) => push(text, 'error'),
    }),
    [push],
  );

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), VISIBLE_MS);
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
          {message.text}
        </div>
      )}
    </ToastContext.Provider>
  );
}
