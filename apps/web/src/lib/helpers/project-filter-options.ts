import "server-only";

import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { projectService } from "@/lib/services/project.service";

const PROJECT_FILTER_OPTIONS_LIMIT = 100;

export async function getProjectFilterOptions(
  selectedProjectId?: string | null,
): Promise<ProjectFilterOption[]> {
  const projectsPage = await projectService.listProjects({
    limit: PROJECT_FILTER_OPTIONS_LIMIT,
  });
  const projectOptions = projectsPage.projects.map((project) => ({
    id: project.id,
    name: project.name,
    logo: project.logo,
    designMd: project.designMd,
    briefingUrl: project.briefingUrl,
    contextMd: project.contextMd,
  }));

  if (
    !selectedProjectId ||
    projectOptions.some((project) => project.id === selectedProjectId)
  ) {
    return projectOptions;
  }

  const selectedProject =
    await projectService.getProjectById(selectedProjectId);
  if (!selectedProject) return projectOptions;

  return [
    {
      id: selectedProject.id,
      name: selectedProject.name,
      logo: selectedProject.logo,
      designMd: selectedProject.designMd,
      briefingUrl: selectedProject.briefingUrl,
      contextMd: selectedProject.contextMd,
    },
    ...projectOptions,
  ];
}
