import { useSyncExternalStore } from "react";

export const MOBILE_BREAKPOINT = 768;

const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onStoreChange: () => void): () => void {
  const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

function getSnapshot(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

function getServerSnapshot(): undefined {
  return undefined;
}

/**
 * Mobile match from `(max-width: MOBILE_BREAKPOINT - 1)`.
 * `undefined` during SSR/hydration until the client snapshot runs.
 */
export function useIsMobileMedia(): boolean | undefined {
  return useSyncExternalStore<boolean | undefined>(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
}

/** Coerces unresolved media to `false` (desktop-first). Prefer `useIsMobileMedia` when layout must wait. */
export function useIsMobile() {
  return !!useIsMobileMedia();
}
