import type { GetJobsData, GetTasksData } from "@sokosumi/core-client";

export const PROJECTS_PAGE_LIMIT = 20;

/**
 * Projects index + Instant shell. Keep app-main `p-4` with no extra page
 * horizontal pad (do not `-mx-4` here).
 */
export const PROJECTS_PAGE_SHELL_CLASS = "w-full";

/**
 * Project detail outer shell: centered max-w-6xl container inside main `p-4`.
 *
 * No route draws it any more — the project pages use `TASK_DETAIL_SHELL_CLASS`
 * itself, and project edit is a modal. It survives as
 * the reference width that `TASK_DETAIL_SHELL_CLASS` is pinned against, which
 * is the one thing still asking what a detail page is as wide as.
 */
export const PROJECTS_DETAIL_SHELL_CLASS = "mx-auto w-full max-w-6xl py-6";

/**
 * Full-width shell for the studio and Social pages. The project detail pages
 * use the task detail shell (`TASK_DETAIL_SHELL_CLASS`) instead.
 *
 * Full available width, deliberately. The application shell's own `p-4`
 * remains the only horizontal padding; each page caps its own reading column
 * where its content is prose, rather than the shell capping all of them.
 */
export const PROJECTS_WORKSPACE_SHELL_CLASS = "w-full min-w-0";

/**
 * List card min-height for the Instant skeleton, the empty state, and a browse
 * card with no rows, so those swaps do not thrash CLS. A card with rows ends
 * with them; nothing sits below it, so its shorter height shifts nothing.
 * Keep as a full Tailwind class string so the scanner can see it.
 */
export const PROJECTS_LIST_CARD_MIN_H_CLASS = "min-h-[320px]";

/**
 * Primary browse outer chrome: divided list at all breakpoints (Tasks/Drive rhythm).
 * Square corners on mobile; `md:rounded-xl` + border on desktop.
 * Shared by live `ProjectsView` and the Instant skeleton.
 */
export const PROJECTS_BROWSE_LAYOUT_CLASS =
  "bg-card-background border-border -mx-4 overflow-hidden rounded-none border-0 md:mx-0 md:rounded-xl md:border";

/** Toolbar shared by the Projects index and its loading shell. */
export const PROJECTS_BROWSE_HEADER_ROW_CLASS =
  "flex items-center justify-end gap-3";

/**
 * Card around the browse rows. Shared by live list and Instant skeleton.
 * Same `p-2` inset as the task list, Files and Transactions cards.
 */
export const PROJECTS_BROWSE_CARD_CLASS =
  "bg-card-background overflow-hidden rounded-xl p-2";

/**
 * Stack of browse rows inside the card: separate row cards with a `gap-2`,
 * as the task list, Files and Transactions draw them.
 */
export const PROJECTS_BROWSE_LIST_CLASS = "flex flex-col gap-2";

/**
 * Row geometry shared by live `ProjectListItem`, Instant skeleton, and Drive lists
 * (72px intrinsic).
 */
export const PROJECTS_LIST_ROW_LAYOUT_CLASS =
  "[content-visibility:auto] [contain-intrinsic-size:auto_72px]";

/**
 * Bordered row card shared by live `ProjectListItem` and the Instant skeleton,
 * as the task list draws its rows.
 */
export const PROJECTS_LIST_ROW_CARD_CLASS =
  "bg-background border-border rounded-lg border";

/**
 * Query param value for GET /jobs and GET /tasks when listing resources
 * that are not assigned to any project. HTTP query strings cannot carry
 * JavaScript `null`, and omitting `projectId` means "no filter" (all jobs/tasks).
 * The Core API accepts this literal string and maps it to `projectId IS NULL`.
 */
export const UNASSIGNED_PROJECT_QUERY = "null" as const;

export function unassignedWorkspaceJobsQuery(
  query: Omit<NonNullable<GetJobsData["query"]>, "scope" | "projectId"> = {},
): NonNullable<GetJobsData["query"]> {
  return {
    scope: "workspace",
    projectId: UNASSIGNED_PROJECT_QUERY,
    ...query,
  };
}

export function unassignedWorkspaceTasksQuery(
  query: Omit<NonNullable<GetTasksData["query"]>, "scope" | "projectId"> = {},
): NonNullable<GetTasksData["query"]> {
  return {
    scope: "workspace",
    projectId: UNASSIGNED_PROJECT_QUERY,
    ...query,
  };
}
