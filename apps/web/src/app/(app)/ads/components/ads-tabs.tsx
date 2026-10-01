"use client";

import type { ProjectAdAccount } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { ADS_TABS, adsSearchParams } from "../ads-query";
import { AdsAccounts } from "./ads-accounts";
import { AdsCampaignsSkeleton } from "./ads-campaigns-skeleton";
import { AdsMarketSkeleton } from "./ads-market-skeleton";

interface AdsTabsProps {
  accounts: ProjectAdAccount[];
  /**
   * The server-rendered Campaigns tab. The page only renders it while the URL
   * is on Campaigns, so it is absent for a moment after switching back.
   */
  campaigns: React.ReactNode;
  /** The server-rendered Market tab, present only while the URL is on it. */
  market: React.ReactNode;
  projectId: string;
}

/**
 * Ads' three tabs, driven by `?tab=`. Campaigns is the default and keeps the
 * URL clean. Switching tabs asks the server for the page again so it only
 * loads what is shown.
 */
export function AdsTabs({
  accounts,
  campaigns,
  market,
  projectId,
}: AdsTabsProps) {
  const t = useTranslations("App.Ads");
  const [tab, setTab] = useQueryState(
    "tab",
    adsSearchParams.tab.withOptions({ shallow: false }),
  );

  return (
    <Tabs
      className="gap-6"
      value={tab}
      onValueChange={(value) => {
        const next = ADS_TABS.find((candidate) => candidate === value);
        if (next) void setTab(next);
      }}
    >
      <TabsList
        aria-label={t("tabsLabel")}
        className={cn(
          SEGMENTED_TABS_LIST_CLASS_NAME,
          "app-scrollbar w-fit min-w-0 max-w-full overflow-x-auto",
        )}
      >
        {ADS_TABS.map((candidate) => (
          <TabsTrigger
            key={candidate}
            className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
            value={candidate}
          >
            {t(`tabs.${candidate}`)}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="campaigns">
        {accounts.length === 0 ? (
          <EmptyState
            action={
              <Button onClick={() => void setTab("accounts")} type="button">
                {t("campaigns.emptyAction")}
              </Button>
            }
            description={t("campaigns.emptyBody")}
            title={t("campaigns.emptyTitle")}
          />
        ) : (
          (campaigns ?? <AdsCampaignsSkeleton />)
        )}
      </TabsContent>
      <TabsContent value="market">
        {market ?? <AdsMarketSkeleton />}
      </TabsContent>
      <TabsContent value="accounts">
        <AdsAccounts accounts={accounts} projectId={projectId} />
      </TabsContent>
    </Tabs>
  );
}
