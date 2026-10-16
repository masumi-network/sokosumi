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
import { AdsEditCampaignModal } from "@/app/ads/components/ads-edit-campaign-modal";
import { googleFormValuesFromDetails } from "@/lib/ads/google-form-values";
import { adsService } from "@/lib/services/ads.service";

interface AdsCampaignEditProps {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<SearchParams>;
  /**
   * Gives the page its breadcrumb, for a direct link. Over the details page
   * their breadcrumb stays: the modal's slot outlives it closing, and would
   * keep saying Edit.
   */
  breadcrumb?: boolean;
}

/**
 * Edit one Google campaign in a modal, behind the same Social beta and with
 * the same 404s as its details page. Both the edit route and the details
 * page's `@modal/(.)edit` render this. A campaign Sokosumi cannot edit, or
 * one that failed to load, shows why instead of the wizard.
 */
export async function AdsCampaignEdit({
  params,
  searchParams,
  breadcrumb = false,
}: AdsCampaignEditProps) {
  const { campaignId, query, project, account } = await loadGoogleCampaignPage(
    params,
    searchParams,
  );
  const t = await getTranslations("App.Ads");

  let name: string | null = null;
  let modal: React.ReactNode;
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
    modal = campaign.editable ? (
      <AdsEditCampaignModal
        campaign={{
          accountId: account.id,
          accountLabel: t("newCampaign.inAccount", {
            provider: t(`accounts.providers.${account.provider}`),
            name: account.name,
          }),
          campaignId: campaign.id,
          currency: account.currency,
          hasMarketProfile: google.hasMarketProfile,
          initialValues: googleFormValuesFromDetails(details),
          projectId: project.id,
          started: campaign.started,
          targeting: google.targeting,
        }}
      />
    ) : (
      <AdsEditCampaignModal
        notice={
          <p className="text-muted-foreground max-w-[44ch] text-sm text-pretty">
            {campaign.notEditableReason
              ? t(`campaignDetails.notEditable.${campaign.notEditableReason}`)
              : t("editCampaign.errors.conflict")}
          </p>
        }
      />
    );
  } catch (error) {
    modal = (
      <AdsEditCampaignModal
        notice={
          await campaignLoadFailure(error, {
            projectId: project.id,
            provider: account.provider,
          })
        }
      />
    );
  }

  if (!breadcrumb) return modal;
  const detailsHref = campaignDetailsHref(
    project.id,
    account.id,
    campaignId,
    query.range,
  );
  return (
    <>
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
      {modal}
    </>
  );
}
