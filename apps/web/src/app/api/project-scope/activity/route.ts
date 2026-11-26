import { WORKSPACE_COLUMN_ROWS } from "@/app/projects/constants";
import { projectService } from "@/lib/services/project.service";
import { readScopeList } from "../read-scope-list";

export function GET() {
  return readScopeList(() =>
    projectService.listRecentActivity(WORKSPACE_COLUMN_ROWS),
  );
}
