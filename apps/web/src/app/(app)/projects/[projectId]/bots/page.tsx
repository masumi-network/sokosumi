import { SokoBotScope } from "@sokosumi/core-client";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ProjectHeaderActions } from "@/app/projects/components/project-header-actions";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import { SharedBotsSection } from "@/app/soko-bots/components/shared-bots-section";
import { projectService } from "@/lib/services/project.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";

export const instant = false;

interface ProjectBotsPageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * The Bots tab: the Soko Bots that work for this project, and a create
 * dialog preset to this project. It exists only while the tab does.
 */
export default async function ProjectBotsPage({
  params,
}: ProjectBotsPageProps) {
  const { projectId } = await params;
  const [project, workspaceLabels, sharedBots, formatter, t] =
    await Promise.all([
      projectService.getProjectById(projectId),
      getProjectWorkspaceLabels(),
      sokoBotService.listShared().catch(() => null),
      getFormatter(),
      getTranslations("App.Projects.Detail"),
    ]);

  if (!project || !workspaceLabels.bots || !sharedBots) {
    notFound();
  }

  return (
    <ProjectWorkspaceShell
      actions={
        <ProjectHeaderActions
          closedAt={project.closedAt}
          closingAt={project.closingAt}
          projectId={project.id}
          projectRevision={project.projectRevision}
          scheduledSocialPostCount={project.scheduledSocialPostCount}
        />
      }
      createdAt={formatter.dateTime(project.createdAt, "dateTime")}
      updatedAt={formatter.dateTime(project.updatedAt, "dateTime")}
      labels={workspaceLabels}
      identifier={project.identifier}
      projectId={project.id}
      projectLogo={project.logo}
      projectName={project.name}
      websiteUrl={project.websiteUrl}
    >
      <SharedBotsSection
        bots={sharedBots.filter((bot) => bot.projectId === project.id)}
        projects={[{ id: project.id, name: project.name }]}
        canCreatePersonal={false}
        defaultScope={SokoBotScope.PROJECT}
        defaultProjectId={project.id}
        title={t("bots.title")}
      />
    </ProjectWorkspaceShell>
  );
}
