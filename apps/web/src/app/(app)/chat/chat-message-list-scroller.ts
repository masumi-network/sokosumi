/**
 * Native overflow scroller for room + thread message lists.
 * Replaces Radix ScrollArea so the scrollbar tracks the same node as list scroll.
 * The bottom edge meets the composer box directly. Content fades out over
 * the list's bottom padding there, so a row scrolling past the edge is not
 * cut by a straight line beside the box's rounded corner.
 */
export const CHAT_MESSAGE_LIST_SCROLLER_CLASS =
  "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-0.5rem),transparent)] md:[mask-image:linear-gradient(to_bottom,black_calc(100%-0.75rem),transparent)] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/80 [&::-webkit-scrollbar-track]:bg-transparent";
