import type { ProjectAdProvider } from "@sokosumi/core-client";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { AdsCampaignsError } from "@/app/ads/components/ads-campaigns-error";
import { AdsErrorState } from "@/app/ads/components/ads-error-state";
import { toCampaignsLoadError } from "@/app/ads/components/ads-load-error";
import { CoreApiRequestError } from "@/lib/clients/core.client";

/**
 * What a campaign's page shows when Core cannot give the campaign. Core
 * answers 422 only for an id that is not a campaign id, which no link of ours
 * holds, so it is as missing as a 404. A failure that is not Core's is
 * rethrown, for the error boundary.
 */
export async function campaignLoadFailure(
  error: unknown,
  { projectId, provider }: { projectId: string; provider: ProjectAdProvider },
): Promise<ReactNode> {
  if (!(error instanceof CoreApiRequestError)) throw error;
  if (error.status === 404 || error.status === 422) notFound();

  const kind = toCampaignsLoadError(error);
  if (kind === "not_active") {
    return (
      <AdsCampaignsError
        kind={kind}
        projectId={projectId}
        provider={provider}
      />
    );
  }
  const t = await getTranslations("App.Ads.campaignDetails");
  const tCampaigns = await getTranslations("App.Ads.campaigns");
  const tProviders = await getTranslations("App.Ads.accounts.providers");
  return (
    <AdsErrorState
      failedTitle={t("errors.failed")}
      kind={kind}
      unavailableTitle={tCampaigns("errors.unavailable.title", {
        provider: tProviders(provider),
      })}
    />
  );
}
