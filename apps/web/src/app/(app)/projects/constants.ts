import type {
  GetJobsData,
  GetProjectsData,
  GetTasksData,
} from "@sokosumi/core-client";

export const PROJECTS_PAGE_LIMIT = 20;

/**
 * The Projects list shows one state at a time, in `?state=`. Open is the
 * default and covers closing and close-failed projects; only a finished close
 * (`closedAt`) moves a project to Closed.
 */
export const PROJECTS_LIST_STATES = [
  "open",
  "closed",
] as const satisfies ReadonlyArray<
  NonNullable<NonNullable<GetProjectsData["query"]>["state"]>
>;
export type ProjectsListState = (typeof PROJECTS_LIST_STATES)[number];

/** Pinned projects lead the Open view; a Closed card has no Pin to sort by. */
export function projectsListStateQuery(state: ProjectsListState) {
  return { state, pinnedFirst: state === "open" };
}

/**
 * Projects index + Instant shell. Keep app-main `p-4` with no extra page
 * horizontal pad (do not `-mx-4` here).
 */
export const PROJECTS_PAGE_SHELL_CLASS = "w-full";

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
 * Toolbar shared by the Projects index and its loading shell: search takes
 * what the Open/Closed control and New project leave.
 */
export const PROJECTS_BROWSE_HEADER_ROW_CLASS = "flex items-center gap-3";

/**
 * Card around the browse grid. Shared by live list and Instant skeleton.
 * Same `p-2` inset as the task list, Files and Transactions cards. It is the
 * grid's size container, so columns follow the room the sidebar leaves.
 */
export const PROJECTS_BROWSE_CARD_CLASS =
  "bg-card-background @container overflow-hidden rounded-xl p-2";

/**
 * Grid of project cards inside the panel: one column on a phone, two from
 * 36rem of panel, three from 56rem, so a card never drops below ~280px.
 */
export const PROJECTS_BROWSE_LIST_CLASS =
  "grid grid-cols-1 gap-2 @xl:grid-cols-2 @4xl:grid-cols-3";

/**
 * Card geometry shared by live `ProjectListItem` and the Instant skeleton
 * (136px intrinsic: avatar row, two lines of briefing, footer).
 */
export const PROJECTS_CARD_LAYOUT_CLASS =
  "[content-visibility:auto] [contain-intrinsic-size:auto_136px]";

/**
 * Bordered card shared by live `ProjectListItem` and the Instant skeleton,
 * as the task list draws its rows.
 */
export const PROJECTS_CARD_CLASS =
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
