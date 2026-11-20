import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import { PageQuerySearchField } from "@/components/page-query-search-field";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";
import { SearchablePageContent } from "@/components/searchable-page-content";
import { SEO_RESULT_LOCALE } from "@/i18n/seo-result-messages";
import { requestClockHourCycle } from "@/i18n/time-format";
import { SeoResultMessagesProvider } from "@/i18n/use-seo-result-translations";
import type { SeoOwner } from "@/lib/seo/owner";
import { seoService } from "@/lib/services/seo.service";
import { rankPageItems } from "@/lib/utils/page-search";
import english from "../../../../messages/en.json";
import { SeoAuditIndex } from "./components/seo-audit-index";
import { SeoPageError } from "./components/seo-page-error";
import { SeoWorkspace } from "./components/seo-workspace";
import { SeoWorkspaceSwitchDialog } from "./components/seo-workspace-switch-dialog";
import { seoHrefWithout, seoRescopedHref } from "./seo-href";
import { seoLoadErrorStatus } from "./seo-load-error-model";
import { loadSeoAuditIndex, loadSeoAuditSearch } from "./seo-page-data";
import { readSeoPageQuery, seoTab } from "./seo-query";
import { seoAuditSwitchFor } from "./seo-workspace-switch";

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
  const t = await getTranslations("App.Seo");
  const raw = await searchParams;
  const parsed = readSeoPageQuery(raw);
  if (!parsed.success)
    return (
      <WorkspacePageShell title={t("title")}>
        <SeoPageError invalidFilters resetHref="/seo" />
      </WorkspacePageShell>
    );
  const { auditId, projectId, cursor, view, add, tab, q, ...query } =
    parsed.data;
  // The search type and the channel are Traffic controls (useSeoWorkspace): every other tab reads web search
  // in every channel, so a stale one leaves the URL before it can narrow the workspace's first data.
  if ((query.searchType || query.channel) && seoTab(tab) !== "traffic")
    redirect(seoHrefWithout(raw, "searchType", "channel"));
  // `projectId` is the header's Project scope: it filters the Audit list. With `view=project` it opens the
  // Project's own SEO workspace, where its Soko Bot keeps pages outside any Audit.
  const owner: SeoOwner | undefined = auditId
    ? { kind: "audit", id: auditId }
    : projectId && view === "project"
      ? { kind: "project", id: projectId }
      : undefined;
  // Only the Audit list is cached, so a link prefetch must not carry a workspace.
  if (owner) await connection();
  try {
    if (!owner) {
      const tSearch = await getTranslations("App.PageSearch");
      const archived = view === "archived";
      const filters = {
        projectId,
        ...(archived && { status: "archived" as const }),
      };
      const term = q?.trim();
      const index = term
        ? {
            audits: rankPageItems(
              await loadSeoAuditSearch(filters),
              term,
              (audit) => ({ primary: [audit.name] }),
            ),
            pagination: null,
          }
        : await loadSeoAuditIndex({ ...filters, cursor });
      return (
        <WorkspacePageShell title={t("title")}>
          <RefreshPrefetchedPage />
          <SeoAuditIndex
            key={JSON.stringify([projectId, cursor, archived])}
            searchField={
              <PageQuerySearchField inHeader placeholder={tSearch("audits")} />
            }
            archived={archived}
            searching={Boolean(term)}
            cursor={term ? null : (cursor ?? null)}
            audits={index.audits}
            projectId={projectId ?? null}
            nextCursor={index.pagination?.nextCursor ?? null}
            addOpen={add === "1"}
          />
        </WorkspacePageShell>
      );
    }
    const workspace = await seoService.getWorkspace(owner, query);
    // An Audit opens in its own Project's scope (or the workspace view for none).
    if (auditId && (projectId ?? null) !== (workspace.projectId ?? null))
      redirect(seoRescopedHref(raw, workspace.projectId ?? null));
    const results = (
      <SearchablePageContent key={workspace.auditId ?? workspace.projectId}>
        <SeoWorkspace workspace={workspace} />
      </SearchablePageContent>
    );
    return (
      <WorkspacePageShell title={t("title")}>
        {(await getLocale()) === SEO_RESULT_LOCALE ? (
          results
        ) : (
          <SeoResultMessagesProvider
            messages={english.App.Seo}
            hourCycle={requestClockHourCycle(await cookies())}
          >
            {results}
          </SeoResultMessagesProvider>
        )}
      </WorkspacePageShell>
    );
  } catch (error) {
    unstable_rethrow(error);
    const status = seoLoadErrorStatus(error);
    const auditSwitch = await seoAuditSwitchFor(owner, status);
    if (auditSwitch)
      return (
        <WorkspacePageShell title={t("title")}>
          <SeoWorkspaceSwitchDialog {...auditSwitch} />
        </WorkspacePageShell>
      );
    return (
      <WorkspacePageShell title={t("title")}>
        <SeoPageError
          resetHref="/seo"
          status={status}
          owner={owner}
          hasSelection={Boolean(query.pageId || query.scopeId)}
        />
      </WorkspacePageShell>
    );
  }
}
