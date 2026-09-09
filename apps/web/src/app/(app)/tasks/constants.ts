export const TASKS_ROUTE_REFRESH_DEBOUNCE_MS = 500;

/** Delay before auto-retrying a failed jobs-tab first fetch while the tab stays open. */
export const JOBS_TAB_LOAD_RETRY_DELAY_MS = 2000;

/**
 * Task detail outer shell (auth + share): centered max-w-6xl, same width as
 * project detail. Keep task-specific `pb-8 md:px-4` so Instant loading matches.
 */
export const TASK_DETAIL_SHELL_CLASS = "mx-auto w-full max-w-6xl pb-8 md:px-4";

/**
 * Project-detail-style two-column workspace. Single column below `xl`; metadata
 * sits in the right column from `xl` up.
 */
export const TASK_DETAIL_GRID_CLASS =
  "mt-6 grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]";

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
  "mx-auto w-full max-w-6xl px-4 pt-2";
