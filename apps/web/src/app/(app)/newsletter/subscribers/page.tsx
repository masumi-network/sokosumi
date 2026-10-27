import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";
import { z } from "zod";

import { newsletterService } from "@/lib/services/newsletter.service";

import { NewsletterPageShell } from "../components/newsletter-page-shell";
import {
  loadNewsletterProject,
  newsletterWorkspacePage,
} from "../newsletter-project";
import { getNewsletterTabs, newsletterHref } from "../newsletter-tabs";
import { loadSubscriberSearchParams } from "./search-params";
import { Subscribers } from "./subscribers";

export const instant = false;

interface SubscribersPageProps {
  searchParams: Promise<SearchParams>;
}

export default async function SubscribersPage({
  searchParams,
}: SubscribersPageProps) {
  await connection();
  if (!(await newsletterService.isEnabled())) notFound();

  const scope = await loadNewsletterProject(searchParams);
  if (!scope.project) {
    return newsletterWorkspacePage({
      path: "/newsletter/subscribers",
      searchParams,
      unavailable: scope.unavailable,
    });
  }
  const { project } = scope;
  const newsletter = await newsletterService.getSettings(project.id);
  if (!newsletter) redirect(newsletterHref("/newsletter/settings", project.id));

  const query = await loadSubscriberSearchParams(searchParams);
  const search = query.search.trim().slice(0, 254);
  const cursor = z.uuid().safeParse(query.cursor);
  const [response, page, t] = await Promise.all([
    newsletterService.listSubscribers(project.id, {
      limit: 25,
      ...(search ? { search } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(cursor.success ? { cursor: cursor.data } : {}),
    }),
    getTranslations("App.Newsletter"),
    getTranslations("App.Projects.Newsletter"),
  ]);

  return (
    <NewsletterPageShell
      description={t("Subscribers.description")}
      heading={page("projectTitle", { project: project.name })}
      navigationLabel={t("navigation")}
      tabs={getNewsletterTabs(project.id, true, t)}
      title={page("title")}
    >
      <Subscribers
        projectId={project.id}
        newsletterName={newsletter.name}
        contactListId={newsletter.contactListId}
        data={response.data}
        pagination={response.meta.pagination}
      />
    </NewsletterPageShell>
  );
}
