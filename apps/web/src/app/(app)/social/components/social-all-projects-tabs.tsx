"use client";

import { useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";

import {
  SOCIAL_TAB_TRIGGER_CLASS_NAME,
  SOCIAL_TABS,
  SOCIAL_TABS_LIST_CLASS_NAME,
  type SocialTab,
} from "@/app/projects/components/social-posts/constants";
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

function isSocialTab(value: string): value is SocialTab {
  return SOCIAL_TABS.some((candidate) => candidate === value);
}

/**
 * Social's tab row on the all-projects view, the same row a project gets.
 *
 * The calendar spans every project. Drafts, Needs attention, Performance and
 * accounts belong to one project, so their tabs ask for one rather than
 * disappear: a reader who lands here still sees what Social holds and where
 * to go for it.
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
  const tab = tabParam ?? "calendar";

  return (
    <Tabs
      className="gap-4"
      data-testid="social-all-projects-tabs"
      value={tab}
      onValueChange={(value) => {
        if (!isSocialTab(value)) return;
        // The first tab is the default, so it keeps the URL clean.
        void setTabParam(value === "calendar" ? null : value);
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <TabsList
          aria-label={t("title")}
          className={cn(
            SEGMENTED_TABS_LIST_CLASS_NAME,
            SOCIAL_TABS_LIST_CLASS_NAME,
          )}
        >
          {SOCIAL_TABS.map((candidate) => (
            <TabsTrigger
              key={candidate}
              className={cn(
                SEGMENTED_TAB_TRIGGER_CLASS_NAME,
                SOCIAL_TAB_TRIGGER_CLASS_NAME,
              )}
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
            project is asked for where it is needed, on the other tabs.
            Not `notFound()` for a lost id: it came from a switchable scope,
            not from the path, so the repair is to pick another project. */}
        {notice ? <SocialAccountsProjectPrompt notice={notice} /> : null}
        {calendar}
      </TabsContent>
      <TabsContent value="drafts">
        <SocialAccountsProjectPrompt kind="drafts" />
      </TabsContent>
      <TabsContent value="attention">
        <SocialAccountsProjectPrompt kind="attention" notice={notice} />
      </TabsContent>
      <TabsContent value="statistics">
        <SocialAccountsProjectPrompt kind="statistics" notice={notice} />
      </TabsContent>
      <TabsContent value="accounts">
        <SocialAccountsProjectPrompt notice={notice} />
      </TabsContent>
    </Tabs>
  );
}
