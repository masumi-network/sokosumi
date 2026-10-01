import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";
import { Suspense } from "react";

import { ProjectScopePicker } from "@/app/components/project-scope/project-scope-picker";
import { adsService } from "@/lib/services/ads.service";
import { projectService } from "@/lib/services/project.service";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";

import { loadAdsSearchParams, selectAccount } from "./ads-query";
import { AdsCampaignsSection } from "./components/ads-campaigns-section";
import { AdsCampaignsToolbar } from "./components/ads-campaigns-toolbar";
import { AdsMarketSection } from "./components/ads-market-section";
import { AdsPageShell } from "./components/ads-page-shell";
import { AdsRowsSkeleton } from "./components/ads-skeleton";
import { AdsTabs } from "./components/ads-tabs";

// Wait for the current session and project access before rendering.
export const instant = false;

interface AdsPageProps {
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Ads");
  return { title: t("title") };
}

/**
 * Ads, as a top-level destination behind the Social beta.
 *
 * Ad accounts belong to one project, so the page reads `?projectId=` like
 * Social and the studio do, and with no project it asks for one.
 */
export default async function AdsPage({ searchParams }: AdsPageProps) {
  await connection();
  if (!(await hasCurrentUserSocialBetaAccess())) {
    notFound();
  }

  const query = await loadAdsSearchParams(searchParams);
  const t = await getTranslations("App.Ads");
  const projectId = query.projectId?.trim();
  const project = projectId
    ? await projectService.getProjectById(projectId)
    : null;

  if (!project) {
    return (
      <AdsPageShell title={t("title")}>
        <ProjectScopePicker
          action={t("pickAction")}
          // Not `notFound()` for a lost id: it came from a switchable scope,
          // so the repair is to pick another project.
          body={projectId ? t("pickUnavailable") : t("pickBody")}
          testId="ads-no-project"
          title={t("pickTitle")}
        />
      </AdsPageShell>
    );
  }

  const accounts = await adsService.listAccounts(project.id);
  const account = selectAccount(accounts, query.account);

  // Only load campaigns while the Campaigns tab is the one showing: they come
  // from the ad provider, so an Accounts visit should not pay for them.
  const campaigns =
    account && query.tab === "campaigns" ? (
      <div className="flex flex-col gap-6">
        <AdsCampaignsToolbar
          account={account}
          accounts={accounts}
          projectId={project.id}
          range={query.range}
        />
        <Suspense
          key={`${account.id}:${query.range}`}
          fallback={<AdsRowsSkeleton />}
        >
          <AdsCampaignsSection
            account={account}
            projectId={project.id}
            range={query.range}
          />
        </Suspense>
      </div>
    ) : null;

  // The same for Market: its profile and the provider data load on its tab.
  const market =
    query.tab === "market" ? (
      <Suspense fallback={<AdsRowsSkeleton />}>
        <AdsMarketSection projectId={project.id} />
      </Suspense>
    ) : null;

  return (
    <AdsPageShell title={t("title")}>
      <AdsTabs
        accounts={accounts}
        campaigns={campaigns}
        market={market}
        projectId={project.id}
      />
    </AdsPageShell>
  );
}
