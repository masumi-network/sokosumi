import type { NewsletterIssue } from "@sokosumi/core-client";
import { isValidTimezone } from "@sokosumi/utils";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";
import { Temporal } from "temporal-polyfill";

import { newsletterService } from "@/lib/services/newsletter.service";

import { NewsletterPageShell } from "../components/newsletter-page-shell";
import {
  loadNewsletterProject,
  newsletterWorkspacePage,
} from "../newsletter-project";
import { getNewsletterTabs, newsletterHref } from "../newsletter-tabs";
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
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await connection();
  if (!(await newsletterService.isEnabled())) notFound();

  const scope = await loadNewsletterProject(searchParams);
  if (!scope.project) {
    return newsletterWorkspacePage({
      path: "/newsletter/calendar",
      searchParams,
      unavailable: scope.unavailable,
    });
  }
  const { project } = scope;
  const newsletter = await newsletterService.getSettings(project.id);
  if (!newsletter) redirect(newsletterHref("/newsletter/settings", project.id));

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

  const [page, t] = await Promise.all([
    getTranslations("App.Newsletter"),
    getTranslations("App.Projects.Newsletter"),
  ]);

  return (
    <NewsletterPageShell
      description={t("Calendar.description")}
      heading={page("projectTitle", { project: project.name })}
      navigationLabel={t("navigation")}
      tabs={getNewsletterTabs(project.id, true, t)}
      title={page("title")}
    >
      <NewsletterCalendar
        projectId={project.id}
        month={month}
        timeZone={timeZone}
        today={Temporal.Now.plainDateISO(timeZone).toString()}
        issues={issues.filter((issue) =>
          CALENDAR_ISSUE_STATUSES.some((status) => status === issue.status),
        )}
      />
    </NewsletterPageShell>
  );
}
