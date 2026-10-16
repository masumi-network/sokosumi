import { getTranslations } from "next-intl/server";

import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

import { AdsCampaignRowsBones } from "./components/ads-skeleton";

/**
 * Ads' shape while the project loads, as Campaigns (the default tab) draws
 * it: the tab pill with the range and "New campaign" on its right, then the
 * campaign rows.
 */
export default async function AdsLoading() {
  const t = await getTranslations("App.Ads");

  return (
    <WorkspacePageShell title={t("title")}>
      <div aria-busy="true" aria-live="polite" role="status">
        <span className="sr-only">{t("loading")}</span>
        <div aria-hidden className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-9 w-48 max-w-full" />
            <div className="flex items-center gap-2 sm:gap-3">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-32" />
            </div>
          </div>
          <AdsCampaignRowsBones />
        </div>
      </div>
    </WorkspacePageShell>
  );
}
