"use client";

import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { type ReactNode, useEffect } from "react";

import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

type ConnectionsTabValue = "connected-apps" | "mcp";

interface ConnectionsTabsProps {
  connectedAppsContent: ReactNode;
  mcpContent: ReactNode;
}

const ENABLED_TABS: ConnectionsTabValue[] = ["connected-apps", "mcp"];

export function ConnectionsTabs({
  connectedAppsContent,
  mcpContent,
}: ConnectionsTabsProps) {
  const t = useTranslations("App.Connections");
  const [tab, setTab] = useQueryState("tab", {
    defaultValue: "connected-apps",
  });

  const activeTab = ENABLED_TABS.includes(tab as ConnectionsTabValue)
    ? (tab as ConnectionsTabValue)
    : "connected-apps";

  useEffect(() => {
    if (!ENABLED_TABS.includes(tab as ConnectionsTabValue)) {
      void setTab("connected-apps");
    }
  }, [setTab, tab]);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value: string) => {
        void setTab(value);
      }}
      className="flex flex-col gap-5"
    >
      <TabsList className={SEGMENTED_TABS_LIST_CLASS_NAME}>
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
