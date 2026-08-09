/**
 * Root `viewportFit: "cover"` paints under notches / home indicator.
 * App and auth chrome must clear `env(safe-area-inset-*)`.
 * Keep full static Tailwind class strings (no runtime concatenation of
 * arbitrary values) so JIT sees them.
 */

/** Outer header pad: status/notch top + landscape left/right cutouts. */
export const APP_HEADER_SAFE_AREA_PADDING_CLASS =
  "pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]" as const;

/**
 * Opaque paint for the top inset only. Used by HeaderChrome underlay so
 * backdrop-blur does not sample empty/black notch. Height must match the
 * `pt-[env(safe-area-inset-top)]` token above.
 */
export const APP_HEADER_SAFE_AREA_UNDERLAY_CLASS =
  "pointer-events-none absolute inset-x-0 top-0 z-0 h-[env(safe-area-inset-top)] bg-background md:hidden" as const;

/**
 * Main mobile top padding: former `pt-20` (5rem) plus top safe area so
 * content clears the fixed header's taller cover height.
 */
export const APP_MAIN_MOBILE_PT_CLASS =
  "pt-[calc(5rem+env(safe-area-inset-top))]" as const;

/**
 * Viewport height below fixed header (`h-16` / 4rem content row + top inset).
 * Replaces bare `100svh-4rem` under cover.
 */
export const APP_SHELL_BELOW_HEADER_HEIGHT_CLASS =
  "h-[calc(100svh-4rem-env(safe-area-inset-top))]" as const;

export const APP_SHELL_BELOW_HEADER_MIN_HEIGHT_CLASS =
  "min-h-[calc(100svh-4rem-env(safe-area-inset-top))]" as const;

export const APP_SHELL_BELOW_HEADER_MAX_HEIGHT_CLASS =
  "max-h-[calc(100svh-4rem-env(safe-area-inset-top))]" as const;

/** Sticky desktop main column: same below-header calc (header is in-flow). */
export const APP_SHELL_BELOW_HEADER_MD_MIN_HEIGHT_CLASS =
  "md:min-h-[calc(100svh-4rem-env(safe-area-inset-top))]" as const;

export const APP_SHELL_BELOW_HEADER_MD_MAX_HEIGHT_CLASS =
  "md:max-h-[calc(100svh-4rem-env(safe-area-inset-top))]" as const;

/** Auth shell: keep ≥1.5rem (p-6) while clearing all four insets. */
export const AUTH_SHELL_SAFE_AREA_PADDING_CLASS =
  "pt-[max(1.5rem,env(safe-area-inset-top))] pr-[max(1.5rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))]" as const;
