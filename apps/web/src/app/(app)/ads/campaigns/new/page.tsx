import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";

import { PROJECTS_WORKSPACE_SHELL_CLASS } from "@/app/projects/constants";
import { adsService } from "@/lib/services/ads.service";
import { projectService } from "@/lib/services/project.service";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";
import { cn } from "@/lib/utils";

import { loadNewCampaignSearchParams } from "../../ads-query";
import { settleAdsLoad } from "../../components/ads-load-error";
import { AdsNewCampaignForm } from "../../components/ads-new-campaign-form";

// Wait for the current session and project access before rendering.
export const instant = false;

interface NewAdsCampaignPageProps {
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Ads.newCampaign");
  return { title: t("title") };
}

/**
 * The project's trending Market keywords, for "Add from Market". Core serves
 * them from its 24-hour cache and asks the data provider only when that has
 * run out, which is what the Market tab does when it opens too. With no
 * market profile there is nothing to read, and the button does not appear. A
 * failed lookup does the same: this is an extra, not a reason to lose the form.
 */
async function loadMarketKeywords(projectId: string): Promise<string[]> {
  try {
    const profile = await settleAdsLoad(adsService.getMarketProfile(projectId));
    if (profile.error || !profile.data.profile) return [];
    const keywords = await settleAdsLoad(
      adsService.listMarketKeywords(projectId),
    );
    return keywords.error
      ? []
      : keywords.data.keywords.map(({ keyword }) => keyword);
  } catch {
    return [];
  }
}

/**
 * Create a campaign in one of the project's ad accounts, behind the same
 * Social beta as `/ads`. The account comes from `?accountId=`; a project or
 * account that is not there is a 404, since this page is only linked from a
 * campaigns list that showed both.
 */
export default async function NewAdsCampaignPage({
  searchParams,
}: NewAdsCampaignPageProps) {
  await connection();
  if (!(await hasCurrentUserSocialBetaAccess())) {
    notFound();
  }

  const query = await loadNewCampaignSearchParams(searchParams);
  const projectId = query.projectId?.trim();
  const project = projectId
    ? await projectService.getProjectById(projectId)
    : null;
  if (!project) {
    notFound();
  }

  const accounts = await adsService.listAccounts(project.id);
  const account = accounts.find(({ id }) => id === query.accountId);
  if (!account) {
    notFound();
  }

  const t = await getTranslations("App.Ads.newCampaign");
  const tProviders = await getTranslations("App.Ads.accounts.providers");
  const campaignsParams = new URLSearchParams({
    projectId: project.id,
    tab: "campaigns",
    account: account.id,
  });

  return (
    <div className={cn(PROJECTS_WORKSPACE_SHELL_CLASS, "pt-2 md:pt-3")}>
      <div className="flex max-w-180 flex-col gap-10 pb-16">
        <header className="flex flex-col gap-3">
          <Link
            className="text-muted-foreground hover:text-foreground self-start text-sm underline-offset-4 hover:underline"
            href={`/ads?${campaignsParams.toString()}`}
          >
            {t("back")}
          </Link>
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-light tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground text-sm">
              {t("inAccount", {
                provider: tProviders(account.provider),
                name: account.name,
              })}
            </p>
            <p className="text-muted-foreground text-sm">
              {t(`note.${account.provider}`)}
            </p>
          </div>
        </header>
        <AdsNewCampaignForm
          accountId={account.id}
          currency={account.currency}
          marketKeywords={
            account.provider === "google_ads"
              ? loadMarketKeywords(project.id)
              : null
          }
          projectId={project.id}
          provider={account.provider}
        />
      </div>
    </div>
  );
}
