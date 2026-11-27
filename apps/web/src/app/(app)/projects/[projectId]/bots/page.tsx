import { SokoBotScope } from "@sokosumi/core-client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { projectPageMetadata } from "@/app/projects/[projectId]/project-page-metadata";
import { ProjectHeaderActions } from "@/app/projects/components/project-header-actions";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import { PROJECT_LINE_DATE } from "@/app/projects/constants";
import { CreateSokoBotDialog } from "@/app/soko-bots/components/create-soko-bot-dialog.client";
import { ManagedBotSections } from "@/app/soko-bots/components/managed-bot-sections";
import { loadManagedSharedBots } from "@/app/soko-bots/managed-bots";
import { projectService } from "@/lib/services/project.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";

export const instant = false;

interface ProjectBotsPageProps {
  params: Promise<{ projectId: string }>;
}

/** The section's name, then the project's, as the tab title. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const [{ projectId }, t] = await Promise.all([
    params,
    getTranslations("App.Projects.Detail"),
  ]);
  return projectPageMetadata(projectId, t("tabs.bots"));
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
  const projects = [{ id: project.id, name: project.name }];
  const bots = await loadManagedSharedBots(
    sharedBots.filter((bot) => bot.projectId === project.id),
    projects,
  );

  return (
    <ProjectWorkspaceShell
      actions={
        <ProjectHeaderActions
          cmo={project.cmo}
          closedAt={project.closedAt}
          closingAt={project.closingAt}
          projectId={project.id}
          projectRevision={project.projectRevision}
          scheduledSocialPostCount={project.scheduledSocialPostCount}
        />
      }
      cmo={project.cmo}
      createdAt={formatter.dateTime(project.createdAt, "dateTime")}
      updatedAt={formatter.dateTime(project.updatedAt, "dateTime")}
      createdOn={formatter.dateTime(project.createdAt, PROJECT_LINE_DATE)}
      updatedOn={formatter.dateTime(project.updatedAt, PROJECT_LINE_DATE)}
      labels={workspaceLabels}
      identifier={project.identifier}
      projectId={project.id}
      projectLogo={project.logo}
      projectName={project.name}
      websiteUrl={project.websiteUrl}
    >
      <div className="flex flex-col gap-12">
        <ManagedBotSections
          title={t("bots.title")}
          action={
            // Core refuses a new bot in a CMO Project; CMO runs its Cuso.
            project.cmo ? null : (
              <CreateSokoBotDialog
                canCreatePersonal={false}
                projects={projects}
                defaultScope={SokoBotScope.PROJECT}
                defaultProjectId={project.id}
              />
            )
          }
          bots={bots}
          emptyText={t("bots.empty")}
        />
      </div>
    </ProjectWorkspaceShell>
  );
}
