import { projectService } from "@/lib/services/project.service";

import { readScopeList } from "../../read-scope-list";

/**
 * The briefing of the project picked in Copy from a project. Core reads it
 * in the active workspace and answers null for a project the reader cannot
 * open.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  return readScopeList(async () => {
    const project = await projectService.getProjectById(projectId);
    return { briefing: project?.briefing ?? null };
  });
}
