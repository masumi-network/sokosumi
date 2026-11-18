import "server-only";

import { competitorsService } from "@/lib/services/competitors.service";
import { projectService } from "@/lib/services/project.service";

/**
 * The Competitors page's project and what Core holds for it. Null when the
 * project is not in this workspace. Never cached: a check or a change to the
 * list must show on the next visit.
 */
export async function loadCompetitorsPage(projectId: string) {
  const project = await projectService.getProjectById(projectId);
  if (!project) return null;
  return { project, competitors: await competitorsService.get(project.id) };
}
