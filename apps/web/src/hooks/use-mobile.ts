import * as React from "react";

export const MOBILE_BREAKPOINT = 768;

/**
 * Mobile match from `(max-width: MOBILE_BREAKPOINT - 1)`.
 * `undefined` until the media-query subscription runs after mount.
 */
export function useIsMobileMedia(): boolean | undefined {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined,
  );

  // Effect is necessary: Subscribes to external system (media query)
  // Sets up and tears down event listener for window resize
  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

/** Coerces unresolved media to `false` (desktop-first). Prefer `useIsMobileMedia` when layout must wait. */
export function useIsMobile() {
  return !!useIsMobileMedia();
}
