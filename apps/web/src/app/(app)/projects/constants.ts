import type {
  GetJobsData,
  GetTasksData,
} from "@/lib/clients/generated/core/types.gen";

export const PROJECTS_PAGE_LIMIT = 20;

/**
 * Projects index + Instant shell. Cancel authenticated-app-frame main `p-4` on
 * mobile (`-mx-4`) and keep a net `px-2` gutter (Drive/list rhythm).
 * `w-[calc(100%+2rem)]` is required with `-mx-4` under main `overflow-x-hidden`
 * — bare `w-full` only cancels the left edge (chat landing uses the same calc).
 * Desktop restores the main margin and keeps a light `md:px-2`.
 */
export const PROJECTS_PAGE_SHELL_CLASS =
  "w-[calc(100%+2rem)] -mx-4 px-2 md:mx-0 md:w-full md:px-2";

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
 * Workspace modules (`modules.title`): same net `px-2` as the Projects index.
 */
export const PROJECTS_DETAIL_WORKSPACE_CLASS = "mt-6 space-y-3 px-2 md:px-0";

/**
 * Shared list card min-height for Instant skeleton, loaded list, and empty state
 * so route swaps do not thrash CLS. Keep as a full Tailwind class string so the
 * scanner can see it.
 */
export const PROJECTS_LIST_CARD_MIN_H_CLASS = "min-h-[320px]";

/**
 * Primary browse layout: mobile card grid, desktop stacked list chrome.
 * Shared by live `ProjectsView` and Instant skeleton.
 */
export const PROJECTS_BROWSE_LAYOUT_CLASS =
  "grid grid-cols-2 gap-3 md:grid-cols-1 md:gap-0 md:divide-y md:divide-border/50 md:overflow-hidden md:rounded-xl md:border md:border-border/50 md:bg-muted/30 md:px-2";

/**
 * Row geometry shared with Drive list surfaces (72px intrinsic).
 * Prefer `PROJECTS_ITEM_LAYOUT_CLASS` for Projects browse items.
 */
export const PROJECTS_LIST_ROW_LAYOUT_CLASS =
  "[content-visibility:auto] [contain-intrinsic-size:auto_72px]";

/**
 * Item geometry for Projects browse (taller cards on mobile, list rows from md).
 * Shared by live `ProjectListItem` and Instant skeleton items.
 */
export const PROJECTS_ITEM_LAYOUT_CLASS =
  "[content-visibility:auto] [contain-intrinsic-size:auto_148px] md:[contain-intrinsic-size:auto_72px]";

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
