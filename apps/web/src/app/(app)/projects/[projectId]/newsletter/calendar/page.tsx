import type { NewsletterIssue } from "@sokosumi/core-client";
import { isValidTimezone } from "@sokosumi/utils";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";
import { Temporal } from "temporal-polyfill";
import { getNewsletterTabs } from "@/app/projects/[projectId]/newsletter/newsletter-tabs";
import { ProjectHeaderActions } from "@/app/projects/components/project-header-actions";
import { ProjectTabs } from "@/app/projects/components/project-tabs";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import { newsletterService } from "@/lib/services/newsletter.service";
import { projectService } from "@/lib/services/project.service";
import { NewsletterCalendar } from "./calendar";
import {
  CALENDAR_ISSUE_STATUSES,
  getMonthGridRange,
  resolveMonth,
} from "./month";
import { loadCalendarSearchParams } from "./search-params";

export const instant = false;

/** A month holds a handful of issues; stop well before an unbounded loop. */
const MAX_PAGES = 5;

export default async function NewsletterCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  if (!(await newsletterService.isEnabled())) notFound();
  const { projectId } = await params;
  const project = await projectService.getProjectById(projectId);
  if (!project) notFound();
  const newsletter = await newsletterService.getSettings(project.id);
  if (!newsletter) redirect(`/projects/${project.id}/newsletter`);

  const query = await loadCalendarSearchParams(searchParams);
  // Until the browser reports its zone the grid renders in UTC, as Calendar does.
  const timeZone = isValidTimezone(query.timezone) ? query.timezone : "UTC";
  const month = resolveMonth(query.month, timeZone);
  const range = getMonthGridRange(month, timeZone);
  const issues: NewsletterIssue[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await newsletterService.listIssues(project.id, {
      limit: 100,
      ...range,
      ...(cursor ? { cursor } : {}),
    });
    issues.push(...response.data);
    cursor = response.meta.pagination.nextCursor ?? undefined;
    if (!cursor) break;
  }

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
            {t("Calendar.description")}
          </p>
        </header>
        <ProjectTabs
          ariaLabel={t("navigation")}
          tabs={getNewsletterTabs(project.id, true, t)}
        />
        <NewsletterCalendar
          projectId={project.id}
          month={month}
          timeZone={timeZone}
          today={Temporal.Now.plainDateISO(timeZone).toString()}
          issues={issues.filter((issue) =>
            CALENDAR_ISSUE_STATUSES.some((status) => status === issue.status),
          )}
        />
      </div>
    </ProjectWorkspaceShell>
  );
}
