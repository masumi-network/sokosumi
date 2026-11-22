"use client";

import { getProjectsById } from "@sokosumi/core-client";
import { useEffect, useState } from "react";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";

/**
 * Resolves the display label for a selected `projectId` in `DriveTasksFilters`
 * when that project is not yet present in the loaded project options page.
 */
export function useDriveTasksFilterSelectedProjectName(
  projectId: string | null,
  projects: readonly { id: string }[],
  noProjectLabel: string,
): string | null {
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!projectId || projectId === "null") {
      setSelectedProjectName(projectId === "null" ? noProjectLabel : null);
      return;
    }

    if (projects.some((project) => project.id === projectId)) {
      setSelectedProjectName(null);
      return;
    }

    const selectedProjectId = projectId;

    async function fetchSelectedProject() {
      try {
        const response = await getProjectsById({
          client: getBrowserCoreClient(),
          path: { id: selectedProjectId },
          throwOnError: true,
        });
        const selectedProject = response.data?.data;
        if (!selectedProject?.name) {
          return;
        }
        setSelectedProjectName(selectedProject.name);
      } catch {
        setSelectedProjectName(null);
      }
    }

    void fetchSelectedProject();
  }, [projectId, projects, noProjectLabel]);

  return selectedProjectName;
}
