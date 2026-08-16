const PROJECTS_DIRECTORY = "projects";

export function buildProjectBriefingPathname(projectId: string): string {
  return `${PROJECTS_DIRECTORY}/${projectId}/BRIEFING.md`;
}

export function buildProjectContextMdPathname(projectId: string): string {
  return `${PROJECTS_DIRECTORY}/${projectId}/CONTEXT.md`;
}
