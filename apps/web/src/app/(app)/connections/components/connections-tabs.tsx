"use client";

import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { type ReactNode, useEffect } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ConnectionsTabValue =
  | "connected-apps"
  | "api-keys"
  | "mcp"
  | "vendor-access";

interface ConnectionsTabsProps {
  apiKeysContent: ReactNode;
  connectedAppsContent: ReactNode;
  mcpContent: ReactNode;
  vendorAccessContent: ReactNode;
}

const ENABLED_TABS: ConnectionsTabValue[] = [
  "connected-apps",
  "api-keys",
  "mcp",
  "vendor-access",
];

export function ConnectionsTabs({
  apiKeysContent,
  connectedAppsContent,
  mcpContent,
  vendorAccessContent,
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
      <TabsList className="bg-muted/50 flex w-full items-center gap-1 self-start rounded-lg p-1">
        <TabsTrigger
          value="connected-apps"
          className="text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm"
        >
          {t("tabs.connectedApps")}
        </TabsTrigger>
        <TabsTrigger
          value="api-keys"
          className="text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm"
        >
          {t("tabs.apiKeys")}
        </TabsTrigger>
        <TabsTrigger
          value="mcp"
          className="text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm"
        >
          {t("tabs.mcp")}
        </TabsTrigger>
        <TabsTrigger
          value="vendor-access"
          className="text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm"
        >
          {t("tabs.vendorAccess")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="connected-apps">{connectedAppsContent}</TabsContent>
      <TabsContent value="api-keys">{apiKeysContent}</TabsContent>
      <TabsContent value="mcp">{mcpContent}</TabsContent>
      <TabsContent value="vendor-access">{vendorAccessContent}</TabsContent>
    </Tabs>
  );
}
