import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";
import { z } from "zod";
import { getNewsletterTabs } from "@/app/projects/[projectId]/newsletter/newsletter-tabs";
import { ProjectHeaderActions } from "@/app/projects/components/project-header-actions";
import { ProjectTabs } from "@/app/projects/components/project-tabs";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import { newsletterService } from "@/lib/services/newsletter.service";
import { projectService } from "@/lib/services/project.service";
import { loadSubscriberSearchParams } from "./search-params";
import { Subscribers } from "./subscribers";

export const instant = false;

interface SubscribersPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<SearchParams>;
}

export default async function SubscribersPage({
  params,
  searchParams,
}: SubscribersPageProps) {
  if (!(await newsletterService.isEnabled())) notFound();
  const { projectId } = await params;
  const project = await projectService.getProjectById(projectId);
  if (!project) notFound();
  const newsletter = await newsletterService.getSettings(project.id);
  if (!newsletter) redirect(`/projects/${project.id}/newsletter`);

  const query = await loadSubscriberSearchParams(searchParams);
  const search = query.search.trim().slice(0, 254);
  const cursor = z.uuid().safeParse(query.cursor);
  const [response, labels, formatter, t] = await Promise.all([
    newsletterService.listSubscribers(project.id, {
      limit: 25,
      ...(search ? { search } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(cursor.success ? { cursor: cursor.data } : {}),
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
            {t("Subscribers.description")}
          </p>
        </header>
        <ProjectTabs
          ariaLabel={t("navigation")}
          tabs={getNewsletterTabs(project.id, true, t)}
        />
        <Subscribers
          projectId={project.id}
          data={response.data}
          pagination={response.meta.pagination}
        />
      </div>
    </ProjectWorkspaceShell>
  );
}
