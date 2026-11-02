import type { Project } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";
import { createLoader, parseAsString, type SearchParams } from "nuqs/server";

import { ProjectScopeRequired } from "@/app/components/project-scope/project-scope-required";
import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import { projectService } from "@/lib/services/project.service";
import { isUuidString } from "@/lib/utils/uuid";

const loadScopeParams = createLoader({
  projectId: parseAsString,
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
 * project, so it asks for one in the header's project selector, opened over
 * the page. A pick keeps the tab the reader is on, as the switcher always does.
 *
 * A plain async function rather than an async component, for the same reason
 * as `getProjectWorkspaceLabels`: the pages' tests render the tree it returns.
 */
export async function newsletterWorkspacePage({
  unavailable,
}: {
  unavailable: boolean;
}) {
  const t = await getTranslations("App.Newsletter");

  return (
    <WorkspacePageShell title={t("title")}>
      <ProjectScopeRequired
        action={t("pickProject")}
        body={unavailable ? t("pickUnavailable") : t("description")}
        testId="newsletter-no-project"
        title={t("pickProject")}
      />
    </WorkspacePageShell>
  );
}
