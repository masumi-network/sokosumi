import type {
  GetJobsData,
  GetTasksData,
} from "@/lib/clients/generated/core/types.gen";

export const PROJECTS_PAGE_LIMIT = 20;

/**
 * Shared list card min-height for Instant skeleton, loaded list, and empty state
 * so route swaps do not thrash CLS. Keep as a full Tailwind class string so the
 * scanner can see it.
 */
export const PROJECTS_LIST_CARD_MIN_H_CLASS = "min-h-[320px]";

/**
 * Row geometry shared by live `ProjectListItem` and Instant skeleton rows.
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
