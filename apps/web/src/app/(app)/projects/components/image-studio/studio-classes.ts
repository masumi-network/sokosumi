/**
 * The geometry every small toggle in the studio shares.
 *
 * `h-7` with `px-2.5 text-xs font-medium` is this app's own pill — the numbers
 * `TogglePill` uses on the task composer — so the gallery filters and the
 * composer's option chips are the same height as a pill anywhere else in the
 * product. They used to be `px-2.5 py-1` with no height at all, which makes a
 * control whose height is whatever its font happens to measure: about 26px
 * beside the app's 28px pills and 32px buttons, close enough to look like a
 * mistake rather than a decision.
 *
 * Colour and border are each caller's own. A filter and an option say
 * different things when they are on, and only the shape is shared.
 *
 * A plain module beside the components rather than a constant exported from
 * one of them: these are `"use client"` files, and a value imported across
 * that boundary resolves to a client reference instead of to the string.
 */
export const STUDIO_PILL_CLASS =
  "focus-visible:ring-ring-halo inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px]";

export const STUDIO_COLUMN_MOBILE_SHELL_CLASS =
  "max-md:-m-4 max-md:h-[calc(100dvh-8rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] max-md:overflow-hidden" as const;

/** Clear the floating Apple navigation bar as well as the fixed header. */
export const STUDIO_COLUMN_MOBILE_APPLE_HEIGHT_CLASS =
  "max-md:h-[calc(100dvh-8rem-env(safe-area-inset-top)-max(0.75rem,env(safe-area-inset-bottom)))]" as const;

/**
 * Same desktop height as an open chat room: cancel the page pad and sit
 * under the header, so the prompt docks on the bottom edge.
 */
export const STUDIO_COLUMN_FEED_HEIGHT_CLASS =
  "md:-m-4 md:h-[calc(100dvh-4rem-env(safe-area-inset-top))] min-h-0 md:min-h-[28rem]" as const;

/** Chat's own composer gutter. Keep the two boxes the same width. */
export const STUDIO_COMPOSER_GUTTER_CLASS = "px-3 md:px-5" as const;
