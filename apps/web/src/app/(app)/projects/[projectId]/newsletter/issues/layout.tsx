import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getNewsletterTabs } from "@/app/projects/[projectId]/newsletter/newsletter-tabs";
import { ProjectHeaderActions } from "@/app/projects/components/project-header-actions";
import { ProjectTabs } from "@/app/projects/components/project-tabs";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import { newsletterService } from "@/lib/services/newsletter.service";
import { projectService } from "@/lib/services/project.service";

export const instant = false;

export default async function NewsletterIssuesLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  if (!(await newsletterService.isEnabled())) notFound();
  const { projectId } = await params;
  const project = await projectService.getProjectById(projectId);
  if (!project) notFound();
  const newsletter = await newsletterService.getSettings(project.id);
  if (!newsletter) redirect(`/projects/${project.id}/newsletter`);
  const [labels, formatter, t] = await Promise.all([
    getProjectWorkspaceLabels(),
    getFormatter(),
    getTranslations("App.Projects.Newsletter"),
  ]);
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
      labels={labels}
      identifier={project.identifier}
      projectId={project.id}
      projectLogo={project.logo}
      projectName={project.name}
      websiteUrl={project.websiteUrl}
    >
      <div className="min-w-0 space-y-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("Issues.description")}
          </p>
        </header>
        <ProjectTabs
          ariaLabel={t("navigation")}
          tabs={getNewsletterTabs(project.id, true, t)}
        />
        {children}
      </div>
    </ProjectWorkspaceShell>
  );
}
