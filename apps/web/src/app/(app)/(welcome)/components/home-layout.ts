/** The top section over the board, shared with the Instant shell. */
export const HOME_STACK_CLASS = "flex min-w-0 flex-col gap-8 pb-4";

/**
 * Needs you over Projects on the left, the team's day wider on the right
 * (its task names run long). One column below `xl`, in reading order:
 * Needs you, Projects, then the day. Shared with the Instant shell.
 */
export const HOME_BOARD_CLASS =
  "flex min-w-0 flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] xl:items-start";

/** The board's left column: Needs you, then Projects. */
export const HOME_BOARD_COLUMN_CLASS = "flex min-w-0 flex-col gap-5";
