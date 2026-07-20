"use client";

import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { type ReactNode, useEffect } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type DeveloperTabValue = "oauth-clients" | "api-keys";

interface DeveloperTabsProps {
  apiKeysContent: ReactNode;
  oauthClientsContent: ReactNode;
}

const ENABLED_TABS: DeveloperTabValue[] = ["oauth-clients", "api-keys"];

export function DeveloperTabs({
  apiKeysContent,
  oauthClientsContent,
}: DeveloperTabsProps) {
  const t = useTranslations("App.Developer");
  const [tab, setTab] = useQueryState("tab", {
    defaultValue: "oauth-clients",
  });

  const activeTab = ENABLED_TABS.includes(tab as DeveloperTabValue)
    ? (tab as DeveloperTabValue)
    : "oauth-clients";

  useEffect(() => {
    if (!ENABLED_TABS.includes(tab as DeveloperTabValue)) {
      void setTab("oauth-clients");
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
          value="oauth-clients"
          className="text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm"
        >
          {t("tabs.oauthClients")}
        </TabsTrigger>
        <TabsTrigger
          value="api-keys"
          className="text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm"
        >
          {t("tabs.apiKeys")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="oauth-clients">{oauthClientsContent}</TabsContent>
      <TabsContent value="api-keys">{apiKeysContent}</TabsContent>
    </Tabs>
  );
}
