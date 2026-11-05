import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { ProjectScopeRequired } from "@/app/components/project-scope/project-scope-required";
import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import { coworkerService } from "@/lib/services/coworker.service";
import { seoService } from "@/lib/services/seo.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
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
  const { projectId, tab: _tab, ...query } = parsed.data;
  if (!projectId)
    return (
      <WorkspacePageShell title={t("title")}>
        <ProjectScopeRequired title={t("pickTitle")} body={t("pickBody")} />
      </WorkspacePageShell>
    );
  try {
    const [workspace, coworkers, sokoBot] = await Promise.all([
      seoService.getWorkspace(projectId, query),
      coworkerService.listCoworkers("tasks").catch((error: unknown) => {
        unstable_rethrow(error);
        return [];
      }),
      sokoBotService.getMine().catch((error: unknown) => {
        unstable_rethrow(error);
        return null;
      }),
    ]);
    return (
      <WorkspacePageShell title={t("title")}>
        <SeoWorkspace
          key={projectId}
          workspace={workspace}
          coworkers={coworkers}
          sokoBotId={sokoBot?.id ?? null}
        />
      </WorkspacePageShell>
    );
  } catch (error) {
    unstable_rethrow(error);
    return (
      <WorkspacePageShell title={t("title")}>
        <SeoPageError
          resetHref={`/seo?projectId=${encodeURIComponent(projectId)}`}
        />
      </WorkspacePageShell>
    );
  }
}
