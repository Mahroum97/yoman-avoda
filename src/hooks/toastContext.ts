/** Context and hook for the one-line feedback messages. */
import { createContext, useContext } from 'react';

export interface ToastApi {
  show: (text: string) => void;
  error: (text: string) => void;
}

export const ToastContext = createContext<ToastApi>({
  show: () => {},
  error: () => {},
});

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
