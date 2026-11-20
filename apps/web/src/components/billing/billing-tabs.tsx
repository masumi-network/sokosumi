"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
} from "@/components/ui/tabs-classes";
import { cn } from "@/lib/utils";

const ALL_BILLING_TABS = ["subscription", "credits", "coupon"] as const;
const BILLING_TABS_WITHOUT_CREDITS = ["subscription", "coupon"] as const;
type BillingTabValue = (typeof ALL_BILLING_TABS)[number];

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
  const enabledTabs = showCreditsTab
    ? ALL_BILLING_TABS
    : BILLING_TABS_WITHOUT_CREDITS;

  const [activeTab, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral(enabledTabs).withDefault("subscription"),
  );

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value: string) => {
        if ((enabledTabs as readonly string[]).includes(value)) {
          void setTab(value as BillingTabValue);
        }
      }}
      className="flex flex-col gap-5"
    >
      <TabsList className={cn(SEGMENTED_TABS_LIST_CLASS_NAME, "w-fit")}>
        <TabsTrigger
          value="subscription"
          className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
        >
          {tabLabels.subscription}
        </TabsTrigger>
        {showCreditsTab ? (
          <TabsTrigger
            value="credits"
            className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
          >
            {tabLabels.credits}
          </TabsTrigger>
        ) : null}
        <TabsTrigger
          value="coupon"
          className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
        >
          {tabLabels.coupon}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="subscription">{subscriptionContent}</TabsContent>
      {showCreditsTab ? (
        <TabsContent value="credits">{creditsContent}</TabsContent>
      ) : null}
      <TabsContent value="coupon">{couponContent}</TabsContent>
    </Tabs>
  );
}
