import { PROJECTS_PAGE_LIMIT } from "@/app/projects/constants";
import { projectService } from "@/lib/services/project.service";

import { readScopeList } from "./read-scope-list";

/**
 * The first page of the workspace's open projects, or Core's matches for `q`.
 * Open leaves out the reader's Hidden projects, which the switcher never lists.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  return readScopeList(async () => {
    const page = await projectService.listProjects({
      cursor: null,
      limit: PROJECTS_PAGE_LIMIT,
      query: query || undefined,
      state: "open",
    });
    return {
      projects: page.projects,
      nextCursor: page.pagination?.nextCursor ?? null,
    };
  });
}
