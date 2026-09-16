/**
 * Native overflow scroller for room + thread message lists.
 * Replaces Radix ScrollArea so the scrollbar tracks the same node as list scroll.
 * The bottom edge meets the composer box directly and cuts content there.
 */
export const CHAT_MESSAGE_LIST_SCROLLER_CLASS =
  "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-tertiary [&::-webkit-scrollbar-track]:bg-transparent";
