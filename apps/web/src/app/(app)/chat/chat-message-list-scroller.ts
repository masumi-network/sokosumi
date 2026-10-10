/**
 * Native overflow scroller for room + thread message lists.
 * Replaces Radix ScrollArea so the scrollbar tracks the same node as list scroll.
 * The bottom edge meets the composer box directly and cuts content there.
 *
 * Normal scroll coordinates: TanStack owns prepend and streaming anchoring.
 * Disable browser anchoring so it does not apply a second correction.
 */
export const CHAT_MESSAGE_LIST_SCROLLER_CLASS =
  "app-scrollbar flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto [overflow-anchor:none]";

/**
 * The scroller's one child, without its padding. `shrink-0`, or the flex
 * column clamps it to the scroller's height and the list cannot scroll up.
 * `min-h-full justify-end` sits a short transcript on the composer.
 *
 * Clip row overhang so touch targets do not change the scrollable height.
 */
export const CHAT_MESSAGE_LIST_CONTENT_CLASS =
  "flex min-h-full min-w-0 w-full shrink-0 flex-col justify-end overflow-y-clip";
