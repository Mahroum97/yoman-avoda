/**
 * Hash routing, hand-rolled to keep the bundle free of a router dependency.
 * Hash URLs also mean the built app runs from a plain folder or any static
 * host with no server rewrites — which matters for an offline PWA.
 */
import { useCallback, useEffect, useState } from 'react';

export interface Route {
  /** Changes on navigation, including re-opening New after its first save. */
  navigationId: number;
  /** Path segments, e.g. `#/entry/12` -> ['entry', '12'] */
  segments: string[];
  query: URLSearchParams;
}

function parse(navigationId = 0): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, search = ''] = raw.split('?');
  return {
    navigationId,
    segments: path.split('/').filter(Boolean),
    query: new URLSearchParams(search),
  };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);

  useEffect(() => {
    const onChange = () => setRoute(previous => parse(previous.navigationId + 1));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function navigate(path: string): void {
  const hash = path.startsWith('#') ? path : `#${path}`;
  if (window.location.hash === hash) {
    // A second tap on New is still a navigation. First-save replaceState does
    // not notify the router, so comparing only parsed route props leaves the
    // saved draft mounted and makes the button appear to do nothing.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = hash;
  }
}

export function useNavigate(): (path: string) => void {
  return useCallback(navigate, []);
}
