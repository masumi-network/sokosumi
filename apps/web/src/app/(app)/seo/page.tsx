import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import { coworkerService } from "@/lib/services/coworker.service";
import { seoService } from "@/lib/services/seo.service";
import { SeoAuditIndex } from "./components/seo-audit-index";
import { SeoPageError } from "./components/seo-page-error";
import { SeoWorkspace } from "./components/seo-workspace";
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
  try {
    if (!auditId && !projectId) {
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
    const owner = auditId
      ? { kind: "audit" as const, id: auditId }
      : { kind: "project" as const, id: projectId! };
    const [workspace, coworkers] = await Promise.all([
      seoService.getWorkspace(owner, query),
      coworkerService.listCoworkers("tasks").catch((error: unknown) => {
        unstable_rethrow(error);
        return [];
      }),
    ]);
    return (
      <WorkspacePageShell title={t("title")}>
        <SeoWorkspace
          key={workspace.auditId ?? workspace.projectId}
          workspace={workspace}
          coworkers={coworkers}
        />
      </WorkspacePageShell>
    );
  } catch (error) {
    unstable_rethrow(error);
    return (
      <WorkspacePageShell title={t("title")}>
        <SeoPageError resetHref="/seo" />
      </WorkspacePageShell>
    );
  }
}
