import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { NewsletterSettingsForm } from "@/app/projects/[projectId]/newsletter/newsletter-settings-form";
import { ProjectHeaderActions } from "@/app/projects/components/project-header-actions";
import { ProjectTabs } from "@/app/projects/components/project-tabs";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import { EmptyState } from "@/components/common/empty-state";
import { newsletterService } from "@/lib/services/newsletter.service";
import { projectService } from "@/lib/services/project.service";

export const instant = false;

interface ProjectNewsletterPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectNewsletterPage({
  params,
}: ProjectNewsletterPageProps) {
  if (!(await newsletterService.isEnabled())) notFound();

  const { projectId } = await params;
  const project = await projectService.getProjectById(projectId);
  if (!project) notFound();

  const [newsletter, labels, formatter, t] = await Promise.all([
    newsletterService.getSettings(project.id),
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
      <div className="max-w-3xl min-w-0 space-y-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </header>
        <ProjectTabs
          ariaLabel={t("navigation")}
          tabs={[
            {
              id: "settings",
              href: `/projects/${project.id}/newsletter`,
              label: t("settings"),
              exact: true,
            },
          ]}
        />
        {!newsletter ? (
          <EmptyState
            title={t("emptyTitle")}
            description={t("emptyDescription")}
            className="py-4"
          />
        ) : null}
        <NewsletterSettingsForm
          key={newsletter?.id ?? project.id}
          newsletter={newsletter}
          projectId={project.id}
          projectName={project.name}
          projectLogo={project.logo}
        />
      </div>
    </ProjectWorkspaceShell>
  );
}
