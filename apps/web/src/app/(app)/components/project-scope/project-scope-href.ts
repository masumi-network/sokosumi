import { TASK_SCHEDULES_PATH } from "@/app/tasks/utils/task-schedule-view";

export const PROJECT_SCOPE_PARAM = "projectId";

/**
 * Workspace pages that have a project version, with any extra params that
 * version needs. Drive filters by project only in its Tasks view.
 */
const SCOPED_PAGES: Readonly<Record<string, Readonly<Record<string, string>>>> =
  {
    "/tasks": {},
    [TASK_SCHEDULES_PATH]: {},
    "/calendar": {},
    "/drive": { view: "tasks" },
    "/history": {},
  };

const PROJECT_PAGE = /^\/projects\/([^/]+)/;

/**
 * Detail pages of a scoped list. They report their item's project through
 * `ProjectScopeMarker`; a switch there goes back to the list.
 */
const DETAIL_PAGE = new RegExp(`^(/tasks|${TASK_SCHEDULES_PATH})/[^/]+`);

/** Project sub-routes that belong to one project and do not carry over. */
const PROJECT_ONLY_SUBPATHS = new Set(["/edit", "/design-md/edit"]);

interface SearchParamsReader {
  get(name: string): string | null;
}

export function isProjectScopedPath(pathname: string): boolean {
  return Object.hasOwn(SCOPED_PAGES, pathname);
}

const DRIVE_NO_PROJECT = "null";

/**
 * The part of a project page's path after its id ("" on the overview), or
 * null off project pages.
 */
export function projectPageSection(pathname: string): string | null {
  const projectPage = PROJECT_PAGE.exec(pathname);
  return projectPage ? pathname.slice(projectPage[0].length) : null;
}

/**
 * The project the reader is working in: the project page they are on, or the
 * project filter of a scoped workspace page. Null is the workspace view.
 */
export function readProjectScope(
  pathname: string,
  searchParams: SearchParamsReader,
): string | null {
  const projectPage = PROJECT_PAGE.exec(pathname);
  if (projectPage?.[1]) return decodeURIComponent(projectPage[1]);
  if (!isProjectScopedPath(pathname)) return null;
  const projectId = searchParams.get(PROJECT_SCOPE_PARAM);
  // Drive writes "null" for its No project folder: no scope, not an id.
  return projectId && projectId !== DRIVE_NO_PROJECT ? projectId : null;
}

/**
 * A task or schedule detail page: its own path (sub-routes such as `/edit`
 * cut off) and the list it belongs to. Null anywhere else.
 */
export function detailPageOf(
  pathname: string,
): { path: string; list: string } | null {
  const detail = DETAIL_PAGE.exec(pathname);
  if (!detail?.[1]) return null;
  return { path: detail[0], list: detail[1] };
}

/** A scoped page's link for a project, or its workspace view for null. */
function scopedPageHref(page: string, projectId: string | null): string {
  const params = new URLSearchParams(SCOPED_PAGES[page]);
  if (projectId) params.set(PROJECT_SCOPE_PARAM, projectId);
  const query = params.toString();
  return query ? `${page}?${query}` : page;
}

/** A navigation link that keeps the reader's project scope. */
export function scopedHref(href: string, projectId: string | null): string {
  // The workspace view keeps plain links: `/drive` opens Recents.
  if (!projectId || !isProjectScopedPath(href)) return href;
  return scopedPageHref(href, projectId);
}

/**
 * Where choosing a project (or the workspace, as null) takes the reader.
 * A scoped page shows its other version, as Vercel does, with the params
 * that version needs even for the workspace (Drive stays on its Tasks view).
 * A task or schedule detail page goes back to its list. A project page keeps
 * its section. Any other page opens the project.
 *
 * The page's own filters reset: a status or folder chosen for one project
 * rarely means anything in the next.
 */
export function switchScopeHref(
  pathname: string,
  projectId: string | null,
): string {
  if (isProjectScopedPath(pathname)) {
    return scopedPageHref(pathname, projectId);
  }
  const detail = detailPageOf(pathname);
  if (detail) return scopedPageHref(detail.list, projectId);

  const section = projectPageSection(pathname);
  if (section !== null) {
    if (!projectId) return "/projects";
    const keep = PROJECT_ONLY_SUBPATHS.has(section) ? "" : section;
    return `/projects/${encodeURIComponent(projectId)}${keep}`;
  }

  return projectId ? `/projects/${encodeURIComponent(projectId)}` : pathname;
}
