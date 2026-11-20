export const TASKS_ROUTE_REFRESH_DEBOUNCE_MS = 500;

/**
 * The board fills the screen under the app header, `main`'s padding and the
 * 40px Tasks toolbar with its gap (9rem in all). Any taller and `main`
 * scrolls the whole page by the difference. The loading skeleton uses it too.
 */
export const TASKS_BOARD_MIN_HEIGHT_CLASS = "min-h-[calc(100dvh-9rem)]";

/**
 * The board re-renders the whole page on a task event, about a dozen Core
 * reads. Agents send events all day, so it waits for a quiet moment, and
 * never longer than the max wait.
 */
export const TASKS_BOARD_REFRESH_DEBOUNCE_MS = 2_000;
export const TASKS_BOARD_REFRESH_MAX_WAIT_MS = 10_000;

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

/**
 * `TaskCard` frame per density. The tasks loading skeleton uses the same
 * classes, so a padding change cannot make the skeleton jump on load.
 */
export const TASK_CARD_DENSITY_CLASS = {
  normal: "flex flex-col gap-2 p-3",
  compact: "flex flex-col gap-1 px-3 py-2",
} as const;
