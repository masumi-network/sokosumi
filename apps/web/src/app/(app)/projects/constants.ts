import type {
  GetJobsData,
  GetTasksData,
} from "@/lib/clients/generated/core/types.gen";

export const PROJECTS_PAGE_LIMIT = 20;

/**
 * Projects index + Instant shell. Keep app-main `p-4` with no extra page
 * horizontal pad (do not `-mx-4` here). Detail cancels the shell separately
 * for edge-to-edge chrome.
 */
export const PROJECTS_PAGE_SHELL_CLASS = "w-full";

/**
 * Project detail outer shell. Cancel main `p-4` on mobile so the top block can
 * go edge-to-edge; same calc width as the index shell. Desktop keeps a wider gutter.
 */
export const PROJECTS_DETAIL_SHELL_CLASS =
  "min-h-full w-[calc(100%+2rem)] -mx-4 py-6 md:mx-0 md:w-full md:px-6";

/**
 * Detail header + briefing/brand/tasks/jobs/memory: full bleed under the
 * canceled shell (no extra horizontal pad on mobile).
 */
export const PROJECTS_DETAIL_TOP_CLASS = "w-full";

/**
 * Workspace modules (`modules.title`): mobile px-4 horizontal pad.
 */
export const PROJECTS_DETAIL_WORKSPACE_CLASS = "mt-6 space-y-3 px-4 md:px-0";

/**
 * Shared list card min-height for Instant skeleton, loaded list, and empty state
 * so route swaps do not thrash CLS. Keep as a full Tailwind class string so the
 * scanner can see it.
 */
export const PROJECTS_LIST_CARD_MIN_H_CLASS = "min-h-[320px]";

/**
 * Primary browse outer chrome: divided list at all breakpoints (Tasks/Drive rhythm).
 * Square corners on mobile; `md:rounded-xl` + border on desktop.
 * Shared by live `ProjectsView` and Instant skeleton.
 */
export const PROJECTS_BROWSE_LAYOUT_CLASS =
  "bg-muted/30 border-border/50 -mx-6 overflow-hidden rounded-none border-0 md:mx-0 md:rounded-xl md:border";

/**
 * Inner divide wrapper for browse rows. Shared by live list and Instant skeleton.
 */
export const PROJECTS_BROWSE_DIVIDE_CLASS = "divide-border/50 divide-y px-2";

/**
 * Row geometry shared by live `ProjectListItem`, Instant skeleton, and Drive lists
 * (72px intrinsic).
 */
export const PROJECTS_LIST_ROW_LAYOUT_CLASS =
  "[content-visibility:auto] [contain-intrinsic-size:auto_72px]";

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
