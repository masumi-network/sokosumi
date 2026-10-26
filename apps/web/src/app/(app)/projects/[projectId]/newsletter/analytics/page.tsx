import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";
import { getNewsletterTabs } from "@/app/projects/[projectId]/newsletter/newsletter-tabs";
import { ProjectHeaderActions } from "@/app/projects/components/project-header-actions";
import { ProjectTabs } from "@/app/projects/components/project-tabs";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { newsletterService } from "@/lib/services/newsletter.service";
import { projectService } from "@/lib/services/project.service";
import { NewsletterAnalyticsView } from "./newsletter-analytics-view";
import { loadAnalyticsSearchParams } from "./search-params";

export const instant = false;

interface NewsletterAnalyticsPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<SearchParams>;
}

export default async function NewsletterAnalyticsPage({
  params,
  searchParams,
}: NewsletterAnalyticsPageProps) {
  if (!(await newsletterService.isEnabled())) notFound();
  const { projectId } = await params;
  const project = await projectService.getProjectById(projectId);
  if (!project) notFound();
  if (!(await newsletterService.getSettings(project.id)))
    redirect(`/projects/${project.id}/newsletter`);
  const query = await loadAnalyticsSearchParams(searchParams);
  const [analytics, labels, formatter, t] = await Promise.all([
    newsletterService
      .getAnalytics(project.id, {
        from: query.from ?? undefined,
        to: query.to ?? undefined,
        cursor: query.cursor ?? undefined,
      })
      .catch((error: unknown) => {
        if (error instanceof CoreApiRequestError && error.status === 422)
          return null;
        if (error instanceof CoreApiRequestError && error.status === 404)
          notFound();
        throw error;
      }),
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
            {t("Analytics.description")}
          </p>
        </header>
        <ProjectTabs
          ariaLabel={t("navigation")}
          tabs={getNewsletterTabs(project.id, true, t)}
        />
        <NewsletterAnalyticsView projectId={project.id} analytics={analytics} />
      </div>
    </ProjectWorkspaceShell>
  );
}
