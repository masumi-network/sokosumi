import type { ProjectAdAccount } from "@sokosumi/core-client";

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { adsService } from "@/lib/services/ads.service";

import { CORE_RANGE_BY_PARAM, type RangeParam } from "../ads-query";
import { AdsCampaigns } from "./ads-campaigns";
import {
  AdsCampaignsError,
  type CampaignsLoadError,
} from "./ads-campaigns-error";
import { toAdsLoadError } from "./ads-load-error";

/** 409 means the connection is no longer active; the rest is shared. */
export function toCampaignsLoadError(
  error: CoreApiRequestError,
): CampaignsLoadError {
  return error.status === 409 ? "not_active" : toAdsLoadError(error);
}

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
