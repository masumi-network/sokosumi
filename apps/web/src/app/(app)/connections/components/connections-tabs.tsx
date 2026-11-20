"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useNormalizedQueryTab } from "@/hooks/effects/use-normalized-query-tab";
import { cn } from "@/lib/utils";

const ENABLED_TABS = ["connected-apps", "mcp"] as const;

interface ConnectionsTabsProps {
  connectedAppsContent: ReactNode;
  mcpContent: ReactNode;
}

export function ConnectionsTabs({
  connectedAppsContent,
  mcpContent,
}: ConnectionsTabsProps) {
  const t = useTranslations("App.Connections");
  const [activeTab, setTab] = useNormalizedQueryTab(
    "tab",
    ENABLED_TABS,
    "connected-apps",
  );

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value: string) => {
        void setTab(value);
      }}
      className="flex flex-col gap-5"
    >
      <TabsList className={cn(SEGMENTED_TABS_LIST_CLASS_NAME, "w-fit")}>
        <TabsTrigger
          value="connected-apps"
          className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
        >
          {t("tabs.connectedApps")}
        </TabsTrigger>
        <TabsTrigger value="mcp" className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}>
          {t("tabs.mcp")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="connected-apps">{connectedAppsContent}</TabsContent>
      <TabsContent value="mcp">{mcpContent}</TabsContent>
    </Tabs>
  );
}
