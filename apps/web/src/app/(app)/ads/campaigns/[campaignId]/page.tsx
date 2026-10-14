import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";
import {
  CORE_RANGE_BY_PARAM,
  campaignDetailsHref,
  campaignsHref,
  loadCampaignDetailsSearchParams,
} from "@/app/ads/ads-query";
import { campaignLoadFailure } from "@/app/ads/campaigns/campaign-load-failure";
import { AdsCampaignBreadcrumb } from "@/app/ads/components/ads-campaign-breadcrumb";
import { AdsCampaignDetails } from "@/app/ads/components/ads-campaign-details";
import { PROJECTS_WORKSPACE_SHELL_CLASS } from "@/app/projects/constants";
import { adsService } from "@/lib/services/ads.service";
import { projectService } from "@/lib/services/project.service";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";
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
  await connection();
  if (!(await hasCurrentUserSocialBetaAccess())) {
    notFound();
  }

  const { campaignId } = await params;
  const query = await loadCampaignDetailsSearchParams(searchParams);
  const projectId = query.projectId?.trim();
  const project = projectId
    ? await projectService.getProjectById(projectId)
    : null;
  if (!project) {
    notFound();
  }

  const accounts = await adsService.listAccounts(project.id);
  const account = accounts.find(({ id }) => id === query.accountId);
  if (!account || account.provider !== "google_ads") {
    notFound();
  }

  const t = await getTranslations("App.Ads.campaignDetails");

  let body: React.ReactNode;
  try {
    const details = await adsService.getCampaignDetails(
      project.id,
      account.id,
      campaignId,
      CORE_RANGE_BY_PARAM[query.range],
    );
    body = (
      <>
        <AdsCampaignBreadcrumb
          adsHref={campaignsHref(project.id, account.id, query.range)}
          detailsHref={campaignDetailsHref(
            project.id,
            account.id,
            campaignId,
            query.range,
          )}
          name={details.campaign.name}
        />
        <AdsCampaignDetails
          accountId={account.id}
          details={details}
          projectId={project.id}
          range={query.range}
        />
      </>
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
