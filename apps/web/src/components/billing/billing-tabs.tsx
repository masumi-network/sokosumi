"use client";

import { useQueryState } from "nuqs";
import { type ReactNode, useEffect, useMemo } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type BillingTabValue = "subscription" | "credits" | "coupon";

interface BillingTabsProps {
  couponContent: ReactNode;
  creditsContent?: ReactNode;
  showCreditsTab: boolean;
  subscriptionContent: ReactNode;
  tabLabels: {
    coupon: string;
    credits: string;
    subscription: string;
  };
}

export function BillingTabs({
  couponContent,
  creditsContent,
  showCreditsTab,
  subscriptionContent,
  tabLabels,
}: BillingTabsProps) {
  const [tab, setTab] = useQueryState("tab", {
    defaultValue: "subscription",
  });

  const enabledTabs = useMemo<BillingTabValue[]>(
    () =>
      showCreditsTab
        ? ["subscription", "credits", "coupon"]
        : ["subscription", "coupon"],
    [showCreditsTab],
  );

  const activeTab = enabledTabs.includes(tab as BillingTabValue)
    ? (tab as BillingTabValue)
    : "subscription";

  useEffect(() => {
    if (!enabledTabs.includes(tab as BillingTabValue)) {
      void setTab("subscription");
    }
  }, [enabledTabs, setTab, tab]);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value: string) => {
        void setTab(value);
      }}
      className="flex flex-col gap-5"
    >
      <TabsList>
        <TabsTrigger value="subscription">{tabLabels.subscription}</TabsTrigger>
        {showCreditsTab ? (
          <TabsTrigger value="credits">{tabLabels.credits}</TabsTrigger>
        ) : null}
        <TabsTrigger value="coupon">{tabLabels.coupon}</TabsTrigger>
      </TabsList>

      <TabsContent value="subscription">{subscriptionContent}</TabsContent>
      {showCreditsTab ? (
        <TabsContent value="credits">{creditsContent}</TabsContent>
      ) : null}
      <TabsContent value="coupon">{couponContent}</TabsContent>
    </Tabs>
  );
}
