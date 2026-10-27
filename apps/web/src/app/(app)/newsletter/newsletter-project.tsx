import type { Project } from "@sokosumi/core-client";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createLoader, parseAsString, type SearchParams } from "nuqs/server";

import { PROJECTS_PAGE_LIMIT } from "@/app/projects/constants";
import { EmptyState } from "@/components/common/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { projectService } from "@/lib/services/project.service";
import { isUuidString } from "@/lib/utils/uuid";

import { NewsletterPageShell } from "./components/newsletter-page-shell";
import { newsletterHref } from "./newsletter-tabs";

const loadScopeParams = createLoader({
  projectId: parseAsString,
  cursor: parseAsString,
});

/**
 * The project the sidebar's switcher put in `?projectId=`. `unavailable`
 * when the URL names one this workspace does not have (or not a project id at
 * all), so the page can say so instead of 404-ing the whole section.
 */
export async function loadNewsletterProject(
  searchParams: Promise<SearchParams>,
): Promise<{ project: Project } | { project: null; unavailable: boolean }> {
  const { projectId } = await loadScopeParams(searchParams);
  const id = projectId?.trim();
  if (!id) return { project: null, unavailable: false };
  const project = isUuidString(id)
    ? await projectService.getProjectById(id)
    : null;
  return project ? { project } : { project: null, unavailable: true };
}

/**
 * The workspace view of every newsletter tab: newsletters belong to a
 * project, so it lists the projects to pick one from. A pick keeps the tab
 * the reader is on (`path`), as the sidebar's switcher does.
 *
 * A plain async function rather than an async component, for the same reason
 * as `getProjectWorkspaceLabels`: the pages' tests render the tree it returns.
 */
export async function newsletterWorkspacePage({
  path,
  searchParams,
  unavailable,
}: {
  path: string;
  searchParams: Promise<SearchParams>;
  unavailable: boolean;
}) {
  const { cursor } = await loadScopeParams(searchParams);
  const [{ projects, pagination }, t] = await Promise.all([
    projectService.listProjects({
      limit: PROJECTS_PAGE_LIMIT,
      cursor: cursor ?? undefined,
    }),
    getTranslations("App.Newsletter"),
  ]);

  return (
    <NewsletterPageShell
      description={t("description")}
      heading={t("pickProject")}
      title={t("title")}
    >
      {unavailable ? (
        <Alert>
          <AlertDescription>{t("pickUnavailable")}</AlertDescription>
        </Alert>
      ) : null}
      {projects.length ? (
        <ul className="space-y-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Button
                asChild
                variant="outline"
                className="h-auto min-h-11 w-full justify-start whitespace-normal text-start"
              >
                <Link href={newsletterHref(path, project.id)}>
                  <span className="min-w-0 break-words">{project.name}</span>
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            <Button asChild>
              <Link href="/projects?create=true">{t("empty.action")}</Link>
            </Button>
          }
        />
      )}
      {pagination?.nextCursor ? (
        <Button asChild variant="outline">
          <Link
            href={`${path}?${new URLSearchParams({ cursor: pagination.nextCursor })}`}
          >
            {t("nextPage")}
          </Link>
        </Button>
      ) : null}
    </NewsletterPageShell>
  );
}
