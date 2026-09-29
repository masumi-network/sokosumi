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
 * No route draws it any more — the tabbed project areas use
 * `PROJECTS_WORKSPACE_SHELL_CLASS`, and project edit is a modal. It survives as
 * the reference width that `TASK_DETAIL_SHELL_CLASS` is pinned against, which
 * is the one thing still asking what a detail page is as wide as.
 */
export const PROJECTS_DETAIL_SHELL_CLASS = "mx-auto w-full max-w-6xl py-6";

/**
 * The tabbed project workspace: overview, design, memory, social.
 *
 * Full available width, deliberately. The application shell's own `p-4`
 * remains the only horizontal padding; each tab caps its own reading column
 * where its content is prose, rather than the shell capping all of them.
 */
export const PROJECTS_WORKSPACE_SHELL_CLASS = "w-full min-w-0";

/**
 * The project workspace as one surface. Shared with the image studio, which is
 * its own destination now but draws the same card.
 *
 * Deliberately the same card the projects index and Drive already draw —
 * `bg-card-background`, hairline border, `rounded-xl` from `md`, full-bleed
 * and border-free below it. The project page used to be a stack of things
 * floating on the page background: a title, then a rule with tabs on it, then
 * content, then a panel of tiles nested inside. Putting the identity, the tab
 * strip and the active area inside one container is what makes it read as a
 * page of this product rather than as a pile of components.
 *
 * No `overflow-hidden`, unlike the browse card. The studio's assistant column
 * is `position: sticky`, and an ancestor with a clipped overflow silently
 * turns sticky into static. Nothing here needs clipping: the tab rule is
 * straight and the content is inset by its own padding.
 */
export const PROJECTS_WORKSPACE_CARD_CLASS =
  "bg-card-background border-border -mx-4 rounded-none border-0 md:mx-0 md:rounded-xl md:border";

/** Horizontal inset shared by the card's header, tab strip and content. */
export const PROJECTS_WORKSPACE_GUTTER_CLASS = "px-4 md:px-6";

/**
 * Shared list card min-height for Instant skeleton, loaded list, and empty state
 * so route swaps do not thrash CLS. Keep as a full Tailwind class string so the
 * scanner can see it.
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
 * Inner divide wrapper for browse rows. Shared by live list and Instant skeleton.
 * No horizontal padding: the rows carry their own `px-4`, so both the dividers
 * and the row hover run the full width of the card, as the tasks list does.
 */
export const PROJECTS_BROWSE_DIVIDE_CLASS = "divide-border divide-y";

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
