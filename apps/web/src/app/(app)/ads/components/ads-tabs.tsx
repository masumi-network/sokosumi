"use client";

import type { ProjectAdAccount } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";

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

import { AdsAccounts } from "./ads-accounts";

const ADS_TABS = ["campaigns", "market", "accounts"] as const;

/** An unknown `?tab=` parses to null, which falls back to Campaigns. */
const tabParser = parseAsStringLiteral(ADS_TABS).withDefault("campaigns");

interface AdsTabsProps {
  accounts: ProjectAdAccount[];
  projectId: string;
}

/**
 * Ads' three tabs, driven by `?tab=`. Campaigns is the default and keeps the
 * URL clean. Campaigns and Market are empty states until their own tickets
 * fill them.
 */
export function AdsTabs({ accounts, projectId }: AdsTabsProps) {
  const t = useTranslations("App.Ads");
  const [tab, setTab] = useQueryState("tab", tabParser);

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
        <EmptyState
          action={
            <Button onClick={() => void setTab("accounts")} type="button">
              {t("campaigns.emptyAction")}
            </Button>
          }
          description={t("campaigns.emptyBody")}
          title={t("campaigns.emptyTitle")}
        />
      </TabsContent>
      <TabsContent value="market">
        <EmptyState
          description={t("market.emptyBody")}
          title={t("market.emptyTitle")}
        />
      </TabsContent>
      <TabsContent value="accounts">
        <AdsAccounts accounts={accounts} projectId={projectId} />
      </TabsContent>
    </Tabs>
  );
}
