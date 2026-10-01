/**
 * The Task board's column and card shells, shared with other boards (the
 * Soko Bots team) so they stay the same surface rather than look-alikes.
 * Kept out of the client modules so Server Components can import them.
 */
export const BOARD_COLUMN_CLASS =
  "bg-card-background flex min-h-0 min-w-[260px] shrink-0 flex-1 flex-col rounded-xl transition-colors sm:min-w-[280px] lg:min-w-[350px]";

export const BOARD_CARD_CLASS =
  "bg-background border-border relative isolate rounded-lg border transition-[border-color,box-shadow,transform] hover:border-primary hover:shadow-sm press content-in";
