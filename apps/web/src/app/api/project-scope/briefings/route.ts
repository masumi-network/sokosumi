import { briefingCopySources } from "@/app/projects/project-briefing";
import { projectService } from "@/lib/services/project.service";

import { readScopeList } from "../read-scope-list";

/**
 * One page of the workspace's projects that have a briefing, by name only,
 * for the edit form's Copy from a project menu. It reads when the menu
 * opens, so editing never waits on it; `cursor` pages on with Core's cursor.
 */
export async function GET(request: Request) {
  const cursor = new URL(request.url).searchParams.get("cursor");
  return readScopeList(async () => {
    const page = await projectService.listProjects({ cursor, limit: 100 });
    return {
      sources: briefingCopySources(page.projects),
      nextCursor: page.pagination?.nextCursor ?? null,
    };
  });
}
