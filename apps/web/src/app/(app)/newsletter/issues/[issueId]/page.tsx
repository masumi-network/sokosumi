import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";

import { ProjectScopeMarker } from "@/app/components/project-scope/project-scope-marker";
import { newsletterService } from "@/lib/services/newsletter.service";

import { NewsletterPageShell } from "../../components/newsletter-page-shell";
import {
  loadNewsletterProject,
  newsletterWorkspacePage,
} from "../../newsletter-project";
import { getNewsletterTabs, newsletterHref } from "../../newsletter-tabs";
import { NewsletterIssueEditor } from "../issue-editor";

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

  const [{ issueId }, scope] = await Promise.all([
    params,
    loadNewsletterProject(searchParams),
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
      />
    </NewsletterPageShell>
  );
}
