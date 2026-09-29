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
  "max-md:-mt-4 max-md:-mb-4 max-md:h-[calc(100dvh-4rem-env(safe-area-inset-top))] max-md:overflow-hidden" as const;

export const STUDIO_COLUMN_FEED_HEIGHT_CLASS =
  "md:h-[calc(100dvh-6rem-env(safe-area-inset-top))] min-h-0 md:min-h-[28rem]" as const;
