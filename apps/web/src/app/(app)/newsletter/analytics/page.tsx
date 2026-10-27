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
import { NewsletterAnalyticsView } from "./newsletter-analytics-view";
import { loadAnalyticsSearchParams } from "./search-params";

export const instant = false;

interface NewsletterAnalyticsPageProps {
  searchParams: Promise<SearchParams>;
}

export default async function NewsletterAnalyticsPage({
  searchParams,
}: NewsletterAnalyticsPageProps) {
  await connection();
  if (!(await newsletterService.isEnabled())) notFound();

  const scope = await loadNewsletterProject(searchParams);
  if (!scope.project) {
    return newsletterWorkspacePage({
      path: "/newsletter/analytics",
      searchParams,
      unavailable: scope.unavailable,
    });
  }
  const { project } = scope;
  if (!(await newsletterService.getSettings(project.id)))
    redirect(newsletterHref("/newsletter/settings", project.id));

  const query = await loadAnalyticsSearchParams(searchParams);
  const [analytics, page, t] = await Promise.all([
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
    getTranslations("App.Newsletter"),
    getTranslations("App.Projects.Newsletter"),
  ]);

  return (
    <NewsletterPageShell
      description={t("Analytics.description")}
      heading={page("projectTitle", { project: project.name })}
      navigationLabel={t("navigation")}
      tabs={getNewsletterTabs(project.id, true, t)}
      title={page("title")}
    >
      <NewsletterAnalyticsView projectId={project.id} analytics={analytics} />
    </NewsletterPageShell>
  );
}
