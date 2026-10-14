import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";
import {
  CORE_RANGE_BY_PARAM,
  campaignDetailsHref,
  campaignEditHref,
  campaignsHref,
} from "@/app/ads/ads-query";
import { campaignLoadFailure } from "@/app/ads/campaigns/campaign-load-failure";
import { loadGoogleCampaignPage } from "@/app/ads/campaigns/google-campaign-page";
import { loadGoogleSetup } from "@/app/ads/campaigns/google-setup";
import { AdsCampaignBreadcrumb } from "@/app/ads/components/ads-campaign-breadcrumb";
import { EditGoogleCampaignForm } from "@/app/ads/components/ads-campaign-form";
import { PROJECTS_WORKSPACE_SHELL_CLASS } from "@/app/projects/constants";
import { googleFormValuesFromDetails } from "@/lib/ads/google-form-values";
import { adsService } from "@/lib/services/ads.service";
import { cn } from "@/lib/utils";

// Wait for the current session and project access before rendering.
export const instant = false;

interface EditAdsCampaignPageProps {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Ads.editCampaign");
  return { title: t("title") };
}

/**
 * Edit one Google campaign, behind the same Social beta and with the same
 * 404s as its details page. A campaign Sokosumi cannot edit shows why, not the
 * form.
 */
export default async function EditAdsCampaignPage({
  params,
  searchParams,
}: EditAdsCampaignPageProps) {
  const { campaignId, query, project, account } = await loadGoogleCampaignPage(
    params,
    searchParams,
  );

  const t = await getTranslations("App.Ads.editCampaign");
  const tDetails = await getTranslations("App.Ads.campaignDetails");
  const detailsHref = campaignDetailsHref(
    project.id,
    account.id,
    campaignId,
    query.range,
  );

  let name: string | null = null;
  let body: React.ReactNode;
  try {
    // The setup never fails (a lookup that does hides its part), so it loads
    // beside the campaign instead of after it.
    const [details, google] = await Promise.all([
      adsService.getCampaignDetails(
        project.id,
        account.id,
        campaignId,
        CORE_RANGE_BY_PARAM[query.range],
      ),
      loadGoogleSetup(project.id, account.id),
    ]);
    const { campaign } = details;
    name = campaign.name;
    if (!campaign.editable) {
      body = (
        <p className="text-muted-foreground text-sm">
          {campaign.notEditableReason
            ? tDetails(`notEditable.${campaign.notEditableReason}`)
            : t("errors.conflict")}
        </p>
      );
    } else {
      const initialValues = googleFormValuesFromDetails(details);
      body = (
        <EditGoogleCampaignForm
          accountId={account.id}
          campaignId={campaign.id}
          currency={account.currency}
          detailsHref={detailsHref}
          hasMarketProfile={google.hasMarketProfile}
          initialValues={initialValues}
          // Next keeps visited pages mounted, so a campaign that changed (for
          // example by a save) must remount the form to show its new values.
          key={JSON.stringify([campaign.started, initialValues])}
          projectId={project.id}
          started={campaign.started}
          targeting={google.targeting}
        />
      );
    }
  } catch (error) {
    body = await campaignLoadFailure(error, {
      projectId: project.id,
      provider: account.provider,
    });
  }

  return (
    <div className={cn(PROJECTS_WORKSPACE_SHELL_CLASS, "pt-2 md:pt-3")}>
      <div className="flex max-w-180 flex-col gap-10 pb-16">
        <AdsCampaignBreadcrumb
          adsHref={campaignsHref(project.id, account.id, query.range)}
          campaign={name ? { name, href: detailsHref } : undefined}
          page={{
            label: "edit",
            href: campaignEditHref(
              project.id,
              account.id,
              campaignId,
              query.range,
            ),
          }}
        />
        <header className="flex flex-col gap-3">
          <Link
            className="text-muted-foreground hover:text-foreground self-start text-sm underline-offset-4 hover:underline"
            href={detailsHref}
          >
            {t("back")}
          </Link>
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-light tracking-tight">{t("title")}</h1>
            {name ? (
              <p className="text-muted-foreground text-sm">{name}</p>
            ) : null}
          </div>
        </header>
        {body}
      </div>
    </div>
  );
}
