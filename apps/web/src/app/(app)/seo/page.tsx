import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import type { SeoOwner } from "@/lib/seo/owner";
import { seoService } from "@/lib/services/seo.service";
import { SeoAuditIndex } from "./components/seo-audit-index";
import { SeoPageError } from "./components/seo-page-error";
import { SeoWorkspace } from "./components/seo-workspace";
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
  const parsed = readSeoPageQuery(await searchParams);
  if (!parsed.success)
    return (
      <WorkspacePageShell title={t("title")}>
        <SeoPageError invalidFilters resetHref="/seo" />
      </WorkspacePageShell>
    );
  const { auditId, projectId, cursor, tab: _tab, ...query } = parsed.data;
  const owner: SeoOwner | undefined = auditId
    ? { kind: "audit", id: auditId }
    : projectId
      ? { kind: "project", id: projectId }
      : undefined;
  try {
    if (!owner) {
      const index = await seoService.listAudits({ cursor });
      return (
        <WorkspacePageShell title={t("title")}>
          <SeoAuditIndex
            audits={index.audits}
            nextCursor={index.pagination?.nextCursor ?? null}
          />
        </WorkspacePageShell>
      );
    }
    const workspace = await seoService.getWorkspace(owner, query);
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
