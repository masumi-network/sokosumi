"use client";

import { useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";

import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { AdsEmptyState } from "./ads-empty-state";

const ADS_TABS = ["campaigns", "market", "accounts"] as const;

/** An unknown `?tab=` parses to null, which falls back to Campaigns. */
const tabParser = parseAsStringLiteral(ADS_TABS).withDefault("campaigns");

/**
 * Ads' three tabs, driven by `?tab=`. Campaigns is the default and keeps the
 * URL clean. Each panel is an empty state until its own ticket fills it.
 */
export function AdsTabs() {
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
        <AdsEmptyState
          actionLabel={t("campaigns.emptyAction")}
          body={t("campaigns.emptyBody")}
          onAction={() => void setTab("accounts")}
          title={t("campaigns.emptyTitle")}
        />
      </TabsContent>
      <TabsContent value="market">
        <AdsEmptyState
          body={t("market.emptyBody")}
          title={t("market.emptyTitle")}
        />
      </TabsContent>
      <TabsContent value="accounts">
        <AdsEmptyState
          body={t("accounts.emptyBody")}
          title={t("accounts.emptyTitle")}
        />
      </TabsContent>
    </Tabs>
  );
}
