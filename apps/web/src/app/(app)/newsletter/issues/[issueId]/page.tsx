import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";

import { ProjectScopeMarker } from "@/app/components/project-scope/project-scope-marker";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { newsletterService } from "@/lib/services/newsletter.service";

import { NewsletterPageShell } from "../../components/newsletter-page-shell";
import {
  loadNewsletterProject,
  newsletterWorkspacePage,
} from "../../newsletter-project";
import { getNewsletterTabs, newsletterHref } from "../../newsletter-tabs";
import { NewsletterIssueEditor } from "../issue-editor";
import { loadIssueEditorSearchParams } from "../search-params";

export const instant = false;

export default async function NewsletterIssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ issueId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await connection();
  if (!(await newsletterService.isEnabled())) notFound();

  const [{ issueId }, scope, { draftedBySokoBot }] = await Promise.all([
    params,
    loadNewsletterProject(searchParams),
    loadIssueEditorSearchParams(searchParams),
  ]);
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

  const [issue, page, t] = await Promise.all([
    newsletterService.getIssue(project.id, issueId),
    getTranslations("App.Newsletter"),
    getTranslations("App.Projects.Newsletter"),
  ]);
  if (!issue) notFound();
  // After the issue check, so a missing project shows not found, not an error.
  const [subscribers, sendingDomain] = await Promise.all([
    newsletterService.listSubscribers(project.id, {
      limit: 1,
      status: "ACTIVE",
    }),
    newsletterService.getSendingDomain(),
  ]);
  const analytics =
    issue.status === "SENT"
      ? await newsletterService
          .getIssueAnalytics(project.id, issueId)
          .catch((error: unknown) => {
            if (error instanceof CoreApiRequestError && error.status === 404)
              notFound();
            throw error;
          })
      : null;

  return (
    <NewsletterPageShell
      description={t("Issues.description")}
      heading={page("projectTitle", { project: project.name })}
      navigationLabel={t("navigation")}
      tabs={getNewsletterTabs(project.id, true, t)}
      title={page("title")}
    >
      {/* Not a scoped path, so the sidebar learns the project from here and
          a switch goes back to the issues list. */}
      <ProjectScopeMarker projectId={project.id} />
      <NewsletterIssueEditor
        key={issue.id}
        issue={issue}
        projectId={project.id}
        activeSubscribers={subscribers.data.counts.ACTIVE}
        senderName={newsletter.senderName}
        sendingDomain={sendingDomain}
        newsletterSlug={newsletter.publicSlug}
        analytics={analytics}
        draftedBySokoBot={draftedBySokoBot}
      />
    </NewsletterPageShell>
  );
}
