"use client";

import { useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";

import { SOCIAL_TABS } from "@/app/projects/components/social-posts/constants";
import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { SocialAccountsProjectPrompt } from "./social-accounts-project-prompt";

const ALL_PROJECTS_TABS = ["calendar", "drafts", "accounts"] as const;
type AllProjectsTab = (typeof ALL_PROJECTS_TABS)[number];

function isAllProjectsTab(value: string | null): value is AllProjectsTab {
  return ALL_PROJECTS_TABS.some((candidate) => candidate === value);
}

/**
 * Social's tab row on the all-projects view, the same row a project gets.
 *
 * The calendar spans every project. Drafts and accounts belong to one
 * project, so their tabs ask for one rather than disappear: a reader who
 * lands here still sees what Social holds and where to go for it.
 */
export function SocialAllProjectsTabs({
  actions,
  calendar,
  notice,
}: {
  actions: React.ReactNode;
  calendar: React.ReactNode;
  /** Why the scoped project could not be opened, when it could not. */
  notice?: string;
}) {
  const t = useTranslations("App.Projects.SocialPosts");
  const [tabParam, setTabParam] = useQueryState(
    "tab",
    parseAsStringLiteral(SOCIAL_TABS),
  );
  const tab: AllProjectsTab = isAllProjectsTab(tabParam)
    ? tabParam
    : "calendar";

  return (
    <Tabs
      className="gap-4"
      data-testid="social-all-projects-tabs"
      value={tab}
      onValueChange={(value) => {
        if (!isAllProjectsTab(value)) return;
        // The first tab is the default, so it keeps the URL clean.
        void setTabParam(value === "calendar" ? null : value);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <TabsList
          aria-label={t("title")}
          className={cn(
            SEGMENTED_TABS_LIST_CLASS_NAME,
            "app-scrollbar w-fit min-w-0 max-w-full overflow-x-auto",
          )}
        >
          {ALL_PROJECTS_TABS.map((candidate) => (
            <TabsTrigger
              key={candidate}
              className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
              data-testid={`social-posts-tab-${candidate}`}
              value={candidate}
            >
              {t(`sections.${candidate}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {actions}
      </div>

      <TabsContent className="space-y-4" value="calendar">
        {/* The calendar shows every project's posts as they are; picking a
            project is asked for where it is needed, on Drafts and Accounts.
            Not `notFound()` for a lost id: it came from a switchable scope,
            not from the path, so the repair is to pick another project. */}
        {notice ? <SocialAccountsProjectPrompt notice={notice} /> : null}
        {calendar}
      </TabsContent>
      <TabsContent value="drafts">
        <SocialAccountsProjectPrompt kind="drafts" />
      </TabsContent>
      <TabsContent value="accounts">
        <SocialAccountsProjectPrompt notice={notice} />
      </TabsContent>
    </Tabs>
  );
}
