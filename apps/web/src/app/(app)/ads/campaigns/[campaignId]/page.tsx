import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";
import {
  CORE_RANGE_BY_PARAM,
  campaignDetailsHref,
  campaignsHref,
} from "@/app/ads/ads-query";
import { campaignLoadFailure } from "@/app/ads/campaigns/campaign-load-failure";
import { loadGoogleCampaignPage } from "@/app/ads/campaigns/google-campaign-page";
import { AdsCampaignBreadcrumb } from "@/app/ads/components/ads-campaign-breadcrumb";
import { AdsCampaignDetails } from "@/app/ads/components/ads-campaign-details";
import { PROJECTS_WORKSPACE_SHELL_CLASS } from "@/app/projects/constants";
import { adsService } from "@/lib/services/ads.service";
import { cn } from "@/lib/utils";

// Wait for the current session and project access before rendering.
export const instant = false;

interface AdsCampaignDetailsPageProps {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Ads.campaignDetails");
  return { title: t("title") };
}

/**
 * One Google campaign behind the same Social beta as `/ads`. The
 * account comes from `?accountId=`, and this page is only linked from a list
 * that showed the project and the account, so anything that is not there is a
 * 404: a lost project or account, a Meta account, a campaign Google no longer
 * has, or an id that is not a campaign id.
 */
export default async function AdsCampaignDetailsPage({
  params,
  searchParams,
}: AdsCampaignDetailsPageProps) {
  const { campaignId, query, project, account } = await loadGoogleCampaignPage(
    params,
    searchParams,
  );

  const t = await getTranslations("App.Ads.campaignDetails");

  let body: React.ReactNode;
  let name: string | undefined;
  try {
    const details = await adsService.getCampaignDetails(
      project.id,
      account.id,
      campaignId,
      CORE_RANGE_BY_PARAM[query.range],
    );
    name = details.campaign.name;
    body = (
      <AdsCampaignDetails
        accountId={account.id}
        details={details}
        projectId={project.id}
        range={query.range}
      />
    );
  } catch (error) {
    body = await campaignLoadFailure(error, {
      projectId: project.id,
      provider: account.provider,
    });
  }

  return (
    <div className={cn(PROJECTS_WORKSPACE_SHELL_CLASS, "pt-2 md:pt-3")}>
      <div className="flex max-w-180 flex-col gap-3 pb-16">
        <AdsCampaignBreadcrumb
          adsHref={campaignsHref(project.id, account.id, query.range)}
          campaign={
            name
              ? {
                  name,
                  href: campaignDetailsHref(
                    project.id,
                    account.id,
                    campaignId,
                    query.range,
                  ),
                }
              : undefined
          }
        />
        <Link
          className="text-muted-foreground hover:text-foreground self-start text-sm underline-offset-4 hover:underline"
          href={campaignsHref(project.id, account.id, query.range)}
        >
          {t("back")}
        </Link>
        {body}
      </div>
    </div>
  );
}
