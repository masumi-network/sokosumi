/**
 * Fades the bottom of a height-capped, collapsed block into transparency.
 *
 * Its own non-client module: a `"use client"` module hands a Server Component a
 * client reference instead of this string (see `ui/sidebar-classes.ts`).
 */
export const COLLAPSED_FADE_CLASS =
  "mask-[linear-gradient(to_bottom,black_60%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_60%,transparent_100%)]";
