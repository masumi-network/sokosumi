import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";
import { z } from "zod";

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { newsletterService } from "@/lib/services/newsletter.service";

import { NewsletterPageShell } from "../components/newsletter-page-shell";
import {
  loadNewsletterProject,
  newsletterWorkspacePage,
} from "../newsletter-project";
import { getNewsletterTabs, newsletterHref } from "../newsletter-tabs";
import { Issues } from "./issues";
import { loadIssueSearchParams } from "./search-params";

export const instant = false;

export default async function NewsletterIssuesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await connection();
  if (!(await newsletterService.isEnabled())) notFound();

  const scope = await loadNewsletterProject(searchParams);
  if (!scope.project) {
    return newsletterWorkspacePage({
      path: "/newsletter/issues",
      searchParams,
      unavailable: scope.unavailable,
    });
  }
  const { project } = scope;
  const newsletter = await newsletterService.getSettings(project.id);
  if (!newsletter) redirect(newsletterHref("/newsletter/settings", project.id));

  const query = await loadIssueSearchParams(searchParams);
  const cursor = z.uuid().safeParse(query.cursor);
  const [response, subscribers, page, t] = await Promise.all([
    newsletterService
      .listIssues(project.id, {
        limit: 25,
        ...(cursor.success ? { cursor: cursor.data } : {}),
      })
      .catch((error: unknown) => {
        if (error instanceof CoreApiRequestError && error.status === 404)
          notFound();
        throw error;
      }),
    newsletterService.listSubscribers(project.id, {
      limit: 1,
      status: "ACTIVE",
    }),
    getTranslations("App.Newsletter"),
    getTranslations("App.Projects.Newsletter"),
  ]);

  return (
    <NewsletterPageShell
      description={t("Issues.description")}
      heading={page("projectTitle", { project: project.name })}
      navigationLabel={t("navigation")}
      tabs={getNewsletterTabs(project.id, true, t)}
      title={page("title")}
    >
      <Issues
        projectId={project.id}
        issues={response.data}
        pagination={response.meta.pagination}
        activeSubscribers={subscribers.data.counts.ACTIVE}
      />
    </NewsletterPageShell>
  );
}
