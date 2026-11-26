import { useMediaQuery } from "./use-media-query";

export const MOBILE_BREAKPOINT = 768;

const MOBILE_MEDIA_QUERY = `not all and (min-width: ${MOBILE_BREAKPOINT}px)`;

/**
 * Exact complement of Tailwind `md` (`(min-width: MOBILE_BREAKPOINT)`), so
 * fractional widths between 767 and 768 (e.g. 767.2px at 125% zoom) still count as mobile.
 * `undefined` during SSR/hydration until the client snapshot runs.
 */
export function useIsMobileMedia(): boolean | undefined {
  return useMediaQuery(MOBILE_MEDIA_QUERY, undefined);
}

/** Coerces unresolved media to `false` (desktop-first). Prefer `useIsMobileMedia` when layout must wait. */
export function useIsMobile() {
  return !!useIsMobileMedia();
}
