"use client";

import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { type ReactNode, useEffect, useMemo } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type DeveloperTabValue =
  | "oauth-clients"
  | "api-keys"
  | "coworkers"
  | "tasks"
  | "vendors"
  | "docs";

interface DeveloperTabsProps {
  showVendorsTab: boolean;
  oauthClientsContent: ReactNode;
  apiKeysContent: ReactNode;
  coworkersContent: ReactNode;
  tasksContent: ReactNode;
  vendorsContent: ReactNode;
  docsContent: ReactNode;
}

const BASE_TABS: DeveloperTabValue[] = [
  "oauth-clients",
  "api-keys",
  "coworkers",
  "tasks",
  "docs",
];

const TAB_TRIGGER_CLASS_NAME =
  "text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground shrink-0 rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm";

export function DeveloperTabs({
  showVendorsTab,
  oauthClientsContent,
  apiKeysContent,
  coworkersContent,
  tasksContent,
  vendorsContent,
  docsContent,
}: DeveloperTabsProps) {
  const t = useTranslations("App.Developer");
  const [tab, setTab] = useQueryState("tab", {
    defaultValue: "oauth-clients",
  });

  const enabledTabs = useMemo<DeveloperTabValue[]>(() => {
    if (!showVendorsTab) {
      return BASE_TABS;
    }

    return [
      "oauth-clients",
      "api-keys",
      "coworkers",
      "tasks",
      "vendors",
      "docs",
    ];
  }, [showVendorsTab]);

  const activeTab = enabledTabs.includes(tab as DeveloperTabValue)
    ? (tab as DeveloperTabValue)
    : "oauth-clients";

  useEffect(() => {
    if (!enabledTabs.includes(tab as DeveloperTabValue)) {
      void setTab("oauth-clients");
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
      <TabsList className="bg-muted/50 flex w-full max-w-full items-center gap-1 self-start overflow-x-auto rounded-lg p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TabsTrigger value="oauth-clients" className={TAB_TRIGGER_CLASS_NAME}>
          {t("tabs.oauthClients")}
        </TabsTrigger>
        <TabsTrigger value="api-keys" className={TAB_TRIGGER_CLASS_NAME}>
          {t("tabs.apiKeys")}
        </TabsTrigger>
        <TabsTrigger value="coworkers" className={TAB_TRIGGER_CLASS_NAME}>
          {t("tabs.coworkers")}
        </TabsTrigger>
        <TabsTrigger value="tasks" className={TAB_TRIGGER_CLASS_NAME}>
          {t("tabs.tasks")}
        </TabsTrigger>
        {showVendorsTab ? (
          <TabsTrigger value="vendors" className={TAB_TRIGGER_CLASS_NAME}>
            {t("tabs.vendors")}
          </TabsTrigger>
        ) : null}
        <TabsTrigger value="docs" className={TAB_TRIGGER_CLASS_NAME}>
          {t("tabs.docs")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="oauth-clients">{oauthClientsContent}</TabsContent>
      <TabsContent value="api-keys">{apiKeysContent}</TabsContent>
      <TabsContent value="coworkers">{coworkersContent}</TabsContent>
      <TabsContent value="tasks">{tasksContent}</TabsContent>
      {showVendorsTab ? (
        <TabsContent value="vendors">{vendorsContent}</TabsContent>
      ) : null}
      <TabsContent value="docs">{docsContent}</TabsContent>
    </Tabs>
  );
}
