import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";

import { CORE_RANGE_BY_PARAM } from "@/app/ads/ads-query";
import { campaignLoadFailure } from "@/app/ads/campaigns/campaign-load-failure";
import { loadGoogleCampaignPage } from "@/app/ads/campaigns/google-campaign-page";
import { AdsEditCampaignModal } from "@/app/ads/components/ads-edit-campaign-modal";
import { googleFormValuesFromDetails } from "@/lib/ads/google-form-values";
import { loadGoogleSetup } from "@/lib/ads/google-setup";
import { adsService } from "@/lib/services/ads.service";

interface AdsCampaignEditProps {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<SearchParams>;
}

/** Rendered by both the edit route and the details page's `@modal/(.)edit`. */
export async function AdsCampaignEdit({
  params,
  searchParams,
}: AdsCampaignEditProps) {
  const { campaignId, query, project, account } = await loadGoogleCampaignPage(
    params,
    searchParams,
  );
  const t = await getTranslations("App.Ads");

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

  return modal;
}
