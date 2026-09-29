export const TASKS_ROUTE_REFRESH_DEBOUNCE_MS = 500;

/** Delay before auto-retrying a failed jobs-tab first fetch while the tab stays open. */
export const JOBS_TAB_LOAD_RETRY_DELAY_MS = 2000;

/**
 * Task detail outer shell (auth + share): centered max-w-[80rem] (Linear-like
 * ~790px text column + 56px gap + 400px sidebar). Keep task-specific
 * `pb-8 md:px-4` so Instant loading matches.
 */
export const TASK_DETAIL_SHELL_CLASS =
  "mx-auto w-full max-w-[80rem] pb-8 md:px-4";

/**
 * Two-column workspace. Single column below `xl`; metadata sits in the right
 * column (32% clamped to 18-25rem, 3.5rem gap) from `xl` up.
 */
export const TASK_DETAIL_GRID_CLASS =
  "grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_clamp(18rem,32%,25rem)] xl:gap-x-14";

/** Primary column stack (header/description or later sections). */
export const TASK_DETAIL_MAIN_CLASS = "min-w-0 space-y-8";

/**
 * Metadata column. On `xl+` pins to column 2 and spans the two main stacks so
 * document order stays description → properties → rest on mobile.
 */
export const TASK_DETAIL_SIDEBAR_CLASS =
  "min-w-0 xl:col-start-2 xl:row-start-1 xl:row-span-2";

/** Admin / developer owner strip above TaskDetailView — same max width. */
export const TASK_DETAIL_CONTEXT_STRIP_CLASS =
  "mx-auto w-full max-w-[80rem] px-4 pt-2";
