import { projectService } from "@/lib/services/project.service";

import { readScopeList } from "../read-scope-list";

/** The reader's Pinned projects, apart from the activity page (ADR 0036). */
export async function GET() {
  return readScopeList(() => projectService.listPinnedProjects());
}
