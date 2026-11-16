import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { newsletterService } from "@/lib/services/newsletter.service";

import { NewsletterPageShell } from "../components/newsletter-page-shell";
import {
  loadNewsletterProject,
  newsletterWorkspacePage,
} from "../newsletter-project";
import { getNewsletterTabs, newsletterHref } from "../newsletter-tabs";
import { NewsletterCalendar } from "./newsletter-calendar";

export const instant = false;

export { generateNewsletterMetadata as generateMetadata } from "@/app/newsletter/newsletter-project";

/** Core's page limit. ponytail: newest 100 only; the full Calendar has the rest. */
const CALENDAR_ISSUE_LIMIT = 100;

export default async function NewsletterCalendarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await connection();
  if (!(await newsletterService.isEnabled())) notFound();

  const scope = await loadNewsletterProject(searchParams);
  if (!scope.project) {
    return newsletterWorkspacePage({ unavailable: scope.unavailable });
  }
  const { project } = scope;
  const newsletter = await newsletterService.getSettings(project.id);
  if (!newsletter) redirect(newsletterHref("/newsletter/settings", project.id));

  const [response, page, t] = await Promise.all([
    newsletterService
      .listIssues(project.id, { limit: CALENDAR_ISSUE_LIMIT })
      .catch((error: unknown) => {
        if (error instanceof CoreApiRequestError && error.status === 404)
          notFound();
        throw error;
      }),
    getTranslations("App.Newsletter"),
    getTranslations("App.Projects.Newsletter"),
  ]);

  return (
    <NewsletterPageShell
      cmoProjectId={project.cmo ? project.id : undefined}
      navigationLabel={t("navigation")}
      tabs={getNewsletterTabs(project.id, true, t, project.cmo)}
      title={page("title")}
    >
      <NewsletterCalendar
        projectId={project.id}
        issues={response.data}
        total={response.meta.pagination.total}
      />
    </NewsletterPageShell>
  );
}
