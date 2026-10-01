import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ProjectScopePicker } from "@/app/components/project-scope/project-scope-picker";
import { adsService } from "@/lib/services/ads.service";
import { projectService } from "@/lib/services/project.service";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";

import { isCampaignsTab, parseCampaignsSelection } from "./ads-query";
import { AdsCampaignsSection } from "./components/ads-campaigns-section";
import { AdsCampaignsSkeleton } from "./components/ads-campaigns-skeleton";
import { AdsCampaignsToolbar } from "./components/ads-campaigns-toolbar";
import { AdsPageShell } from "./components/ads-page-shell";
import { AdsTabs } from "./components/ads-tabs";

// Wait for the current session and project access before rendering.
export const instant = false;

interface AdsPageProps {
  searchParams: Promise<{
    projectId?: string;
    tab?: string;
    account?: string;
    range?: string;
  }>;
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

  const query = await searchParams;
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
  const selection = parseCampaignsSelection(query, accounts);

  // Only load campaigns while the Campaigns tab is the one showing: they come
  // from the ad provider, so an Accounts visit should not pay for them.
  const campaigns =
    selection && isCampaignsTab(query.tab) ? (
      <div className="flex flex-col gap-6">
        <AdsCampaignsToolbar
          accountId={selection.account.id}
          accounts={accounts}
          range={selection.range}
        />
        <Suspense
          key={`${selection.account.id}:${selection.range}`}
          fallback={<AdsCampaignsSkeleton />}
        >
          <AdsCampaignsSection
            account={selection.account}
            projectId={project.id}
            range={selection.range}
          />
        </Suspense>
      </div>
    ) : null;

  return (
    <AdsPageShell title={t("title")}>
      <AdsTabs
        accounts={accounts}
        campaigns={campaigns}
        projectId={project.id}
      />
    </AdsPageShell>
  );
}
