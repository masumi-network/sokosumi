"use client";

import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { type ReactNode, useEffect } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ConnectionsTabValue =
  | "connected-apps"
  | "api-keys"
  | "coworker-access"
  | "mcp";

interface ConnectionsTabsProps {
  apiKeysContent: ReactNode;
  connectedAppsContent: ReactNode;
  coworkerAccessContent: ReactNode;
  mcpContent: ReactNode;
}

const ENABLED_TABS: ConnectionsTabValue[] = [
  "connected-apps",
  "api-keys",
  "coworker-access",
  "mcp",
];

export function ConnectionsTabs({
  apiKeysContent,
  connectedAppsContent,
  coworkerAccessContent,
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
          value="coworker-access"
          className="text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm"
        >
          {t("tabs.coworkerAccess")}
        </TabsTrigger>
        <TabsTrigger
          value="mcp"
          className="text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm"
        >
          {t("tabs.mcp")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="connected-apps">{connectedAppsContent}</TabsContent>
      <TabsContent value="api-keys">{apiKeysContent}</TabsContent>
      <TabsContent value="coworker-access">{coworkerAccessContent}</TabsContent>
      <TabsContent value="mcp">{mcpContent}</TabsContent>
    </Tabs>
  );
}
