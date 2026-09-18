/**
 * Native overflow scroller for room + thread message lists.
 * Replaces Radix ScrollArea so the scrollbar tracks the same node as list scroll.
 * The bottom edge meets the composer box directly and cuts content there.
 *
 * Bottom-anchored (`flex-col-reverse`): `scrollTop` is 0 at the newest
 * message and negative above it, so a row above the viewport that turns out
 * taller than its estimate never moves what is on screen and no scroll write
 * has to put it back. iOS cannot take that write during a touch scroll.
 */
export const CHAT_MESSAGE_LIST_SCROLLER_CLASS =
  "flex min-h-0 min-w-0 flex-1 flex-col-reverse overflow-x-hidden overflow-y-auto [overflow-anchor:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-tertiary [&::-webkit-scrollbar-track]:bg-transparent";

/**
 * The scroller's one child, without its padding. `shrink-0`, or the flex
 * column clamps it to the scroller's height and the list cannot scroll up.
 * `min-h-full justify-end` sits a short transcript on the composer.
 */
export const CHAT_MESSAGE_LIST_CONTENT_CLASS =
  "flex min-h-full min-w-0 w-full shrink-0 flex-col justify-end";
