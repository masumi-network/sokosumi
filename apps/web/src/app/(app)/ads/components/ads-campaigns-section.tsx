import type { ProjectAdAccount } from "@sokosumi/core-client";

import { CORE_RANGE_BY_PARAM, type RangeParam } from "@/app/ads/ads-query";
import { toCampaignsLoadError } from "@/lib/ads/ads-load-error";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { adsService } from "@/lib/services/ads.service";
import { AdsCampaigns } from "./ads-campaigns";
import { AdsCampaignsError } from "./ads-campaigns-error";

interface AdsCampaignsSectionProps {
  account: ProjectAdAccount;
  projectId: string;
  range: RangeParam;
}

/**
 * Loads one account's campaigns on the server, inside the tab's Suspense
 * boundary. A Core failure becomes the tab's own error; anything else (such
 * as a lost session) still reaches the route's error boundary.
 */
export async function AdsCampaignsSection({
  account,
  projectId,
  range,
}: AdsCampaignsSectionProps) {
  try {
    const { campaigns, currency } = await adsService.listCampaigns(
      projectId,
      account.id,
      CORE_RANGE_BY_PARAM[range],
    );
    return (
      <AdsCampaigns
        accountId={account.id}
        campaigns={campaigns}
        currency={currency}
        projectId={projectId}
        provider={account.provider}
        range={range}
      />
    );
  } catch (error) {
    if (!(error instanceof CoreApiRequestError)) throw error;
    return (
      <AdsCampaignsError
        kind={toCampaignsLoadError(error)}
        projectId={projectId}
        provider={account.provider}
      />
    );
  }
}
