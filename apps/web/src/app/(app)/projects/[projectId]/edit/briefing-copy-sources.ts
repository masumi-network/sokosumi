import "server-only";

import { unstable_rethrow } from "next/navigation";

import {
  type BriefingCopySource,
  briefingCopySources,
} from "@/app/projects/project-briefing";
import { projectService } from "@/lib/services/project.service";

// ponytail: stops after 2,000 projects; move the filter into Core if a
// workspace ever has more.
const MAX_PAGES = 20;

/**
 * The workspace's other projects with a briefing, for the edit page's copy
 * menu. Core lists only the active workspace's projects the reader can open.
 * The menu is optional: a failed list hides it rather than the edit form.
 */
export async function loadBriefingCopySources(
  projectId: string,
): Promise<BriefingCopySource[]> {
  try {
    const projects = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await projectService.listProjects({ cursor, limit: 100 });
      projects.push(...result.projects);
      cursor = result.pagination?.nextCursor ?? null;
      if (!cursor) break;
    }
    return briefingCopySources(projects, projectId);
  } catch (error) {
    unstable_rethrow(error);
    return [];
  }
}
