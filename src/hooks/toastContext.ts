/** Context and hook for the one-line feedback messages. */
import { createContext, useContext } from 'react';

/**
 * A single button offered alongside the message — undo, in practice.
 *
 * It is what lets a page be swiped away without a confirmation dialog standing
 * in front of every deletion: the page goes, and taking it back is one tap for
 * as long as the message is up.
 */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastApi {
  show: (text: string, action?: ToastAction) => void;
  error: (text: string) => void;
}

export const ToastContext = createContext<ToastApi>({
  show: () => {},
  error: () => {},
});

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
