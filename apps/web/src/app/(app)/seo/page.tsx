import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import type { SeoOwner } from "@/lib/seo/owner";
import { seoService } from "@/lib/services/seo.service";
import { SeoAuditIndex } from "./components/seo-audit-index";
import { SeoPageError } from "./components/seo-page-error";
import { SeoWorkspace } from "./components/seo-workspace";
import { seoRescopedHref } from "./seo-href";
import { seoLoadErrorStatus } from "./seo-load-error-model";
import { readSeoPageQuery } from "./seo-query";

export const instant = false;
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Seo");
  return { title: t("title") };
}

export default async function SeoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const t = await getTranslations("App.Seo");
  const raw = await searchParams;
  const parsed = readSeoPageQuery(raw);
  if (!parsed.success)
    return (
      <WorkspacePageShell title={t("title")}>
        <SeoPageError invalidFilters resetHref="/seo" />
      </WorkspacePageShell>
    );
  const { auditId, projectId, cursor, view, tab: _tab, ...query } = parsed.data;
  // `projectId` is the header's Project scope: it filters the Audit list. With `view=project` it opens the
  // Project's own SEO workspace, where its Soko Bot keeps pages outside any Audit.
  const owner: SeoOwner | undefined = auditId
    ? { kind: "audit", id: auditId }
    : projectId && view === "project"
      ? { kind: "project", id: projectId }
      : undefined;
  try {
    if (!owner) {
      const index = await seoService.listAudits({ cursor, projectId });
      return (
        <WorkspacePageShell title={t("title")}>
          <SeoAuditIndex
            audits={index.audits}
            projectId={projectId ?? null}
            nextCursor={index.pagination?.nextCursor ?? null}
          />
        </WorkspacePageShell>
      );
    }
    const workspace = await seoService.getWorkspace(owner, query);
    // An Audit opens in its own Project's scope (or the workspace view for none).
    if (auditId && (projectId ?? null) !== (workspace.projectId ?? null))
      redirect(seoRescopedHref(raw, workspace.projectId ?? null));
    return (
      <WorkspacePageShell title={t("title")}>
        <SeoWorkspace
          key={workspace.auditId ?? workspace.projectId}
          workspace={workspace}
        />
      </WorkspacePageShell>
    );
  } catch (error) {
    unstable_rethrow(error);
    return (
      <WorkspacePageShell title={t("title")}>
        <SeoPageError
          resetHref="/seo"
          status={seoLoadErrorStatus(error)}
          owner={owner}
          hasSelection={Boolean(query.pageId || query.scopeId)}
        />
      </WorkspacePageShell>
    );
  }
}
