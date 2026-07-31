/**
 * Hash routing, hand-rolled to keep the bundle free of a router dependency.
 * Hash URLs also mean the built app runs from a plain folder or any static
 * host with no server rewrites — which matters for an offline PWA.
 */
import { useCallback, useEffect, useState } from 'react';

export interface Route {
  /** Path segments, e.g. `#/entry/12` -> ['entry', '12'] */
  segments: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, search = ''] = raw.split('?');
  return {
    segments: path.split('/').filter(Boolean),
    query: new URLSearchParams(search),
  };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);

  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith('#') ? path : `#${path}`;
}

export function useNavigate(): (path: string) => void {
  return useCallback(navigate, []);
}
