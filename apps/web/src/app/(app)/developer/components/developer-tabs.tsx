"use client";

import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { type ReactNode, useEffect } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type DeveloperTabValue =
  | "oauth-clients"
  | "api-keys"
  | "coworkers"
  | "tasks"
  | "docs";

interface DeveloperTabsProps {
  oauthClientsContent: ReactNode;
  apiKeysContent: ReactNode;
  coworkersContent: ReactNode;
  tasksContent: ReactNode;
  docsContent: ReactNode;
}

const ENABLED_TABS: DeveloperTabValue[] = [
  "oauth-clients",
  "api-keys",
  "coworkers",
  "tasks",
  "docs",
];

const TAB_TRIGGER_CLASS_NAME =
  "text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground shrink-0 rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm";

export function DeveloperTabs({
  oauthClientsContent,
  apiKeysContent,
  coworkersContent,
  tasksContent,
  docsContent,
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
        <TabsTrigger value="docs" className={TAB_TRIGGER_CLASS_NAME}>
          {t("tabs.docs")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="oauth-clients">{oauthClientsContent}</TabsContent>
      <TabsContent value="api-keys">{apiKeysContent}</TabsContent>
      <TabsContent value="coworkers">{coworkersContent}</TabsContent>
      <TabsContent value="tasks">{tasksContent}</TabsContent>
      <TabsContent value="docs">{docsContent}</TabsContent>
    </Tabs>
  );
}
