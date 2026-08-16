const PROJECTS_DIRECTORY = "projects";

export function buildProjectFilesRootPrefix(projectId: string): string {
  return `${PROJECTS_DIRECTORY}/${projectId}/`;
}

export function buildProjectFilesPrefix(
  projectId: string,
  filesToken: string,
): string {
  return `${buildProjectFilesRootPrefix(projectId)}${filesToken}/`;
}

export function buildProjectBriefingPathname(
  projectId: string,
  filesToken: string,
): string {
  return `${buildProjectFilesPrefix(projectId, filesToken)}BRIEFING.md`;
}

export function buildProjectContextMdPathname(
  projectId: string,
  filesToken: string,
): string {
  return `${buildProjectFilesPrefix(projectId, filesToken)}CONTEXT.md`;
}
