import { useMediaQuery } from "./use-media-query";

export const MOBILE_BREAKPOINT = 768;

const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * Mobile match from `(max-width: MOBILE_BREAKPOINT - 1)`.
 * `undefined` during SSR/hydration until the client snapshot runs.
 */
export function useIsMobileMedia(): boolean | undefined {
  return useMediaQuery(MOBILE_MEDIA_QUERY, undefined);
}

/** Coerces unresolved media to `false` (desktop-first). Prefer `useIsMobileMedia` when layout must wait. */
export function useIsMobile() {
  return !!useIsMobileMedia();
}
