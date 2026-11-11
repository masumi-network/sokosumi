"use client";

import { useSelectedScopeProject } from "@/app/components/project-scope/use-scope-projects";
import { CmoProjectBanner } from "@/components/cmo-project-banner";

/**
 * The "Managed by CMO" banner while Drive is filtered to a CMO Project. Drive
 * is a client page, so it reads the Project the way the scope switcher does.
 */
export function DriveCmoProjectBanner({
  projectId,
}: {
  projectId: string | null;
}) {
  const project = useSelectedScopeProject(projectId);
  return project?.cmo ? (
    <CmoProjectBanner className="mb-4" projectId={project.id} />
  ) : null;
}
