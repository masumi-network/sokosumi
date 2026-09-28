import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { ProjectMemoryPanel } from "@/app/projects/components/project-memory-panel";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import { projectService } from "@/lib/services/project.service";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";

// Wait for the current session and project access before rendering, as the
// project's other areas do.
export const instant = false;

interface ProjectMemoryPageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * The Memory tab: CONTEXT.md, read on the page rather than in a dialog.
 *
 * The content is fetched here rather than in the panel because Core already
 * hands the whole document to the server in one call, and the tab's own route
 * is the natural place to spend it: no spinner, no click, and the document is
 * in the HTML for anyone who lands on the link.
 */
export default async function ProjectMemoryPage({
  params,
}: ProjectMemoryPageProps) {
  const [socialBetaEnabled, { projectId }] = await Promise.all([
    hasCurrentUserSocialBetaAccess(),
    params,
  ]);
  const project = await projectService.getProjectById(projectId);

  if (!project) {
    notFound();
  }

  const [contextMd, t, formatter] = await Promise.all([
    // Null when this project has never had a memory written; the metadata on
    // the project record says whether to expect one.
    project.contextMd
      ? projectService.getProjectContextMd(project.id)
      : Promise.resolve(null),
    getTranslations("App.Projects.Detail"),
    getFormatter(),
  ]);
  const workspaceLabels = await getProjectWorkspaceLabels();

  return (
    <ProjectWorkspaceShell
      metadata={[
        {
          label: t("header.updated"),
          value: formatter.dateTime(project.updatedAt, "dateTime"),
        },
      ]}
      labels={workspaceLabels}
      projectId={project.id}
      projectLogo={project.logo}
      projectName={project.name}
      showSocialTab={socialBetaEnabled}
      websiteUrl={project.websiteUrl}
    >
      <ProjectMemoryPanel
        content={contextMd?.content ?? null}
        contextMd={project.contextMd}
        contextMdUpdating={project.contextMdUpdating}
        memoryEnabled={project.memoryEnabled}
        memoryModel={project.memoryModel}
      />
    </ProjectWorkspaceShell>
  );
}
