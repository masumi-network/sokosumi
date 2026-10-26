"use client";

import { useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";

import {
  SOCIAL_TABS,
  type SocialTab,
} from "@/app/projects/components/social-posts/constants";
import { SocialLoadError } from "@/app/projects/components/social-posts/social-load-error";
import { SocialPostStatistics } from "@/app/projects/components/social-posts/social-post-statistics";
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
 * The calendar and Performance span every project. Drafts, Needs attention
 * and accounts belong to one project, so those tabs ask for one rather than disappear.
 */
export function SocialAllProjectsTabs({
  actions,
  calendar,
  notice,
  projectFailed = false,
  workspaceId,
}: {
  actions: React.ReactNode;
  calendar: React.ReactNode;
  /** Why the scoped project could not be opened, when it could not. */
  notice?: string;
  /**
   * The scoped project failed to load (not "it is gone"). A slim banner offers
   * a retry above the tabs that need a project; Performance spans every project.
   */
  projectFailed?: boolean;
  workspaceId: string;
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
      <div className="flex flex-row items-center justify-between gap-3 max-md:items-start">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <TabsList
            aria-label={t("title")}
            className={cn(
              SEGMENTED_TABS_LIST_CLASS_NAME,
              "w-fit min-w-0 max-w-full max-md:h-auto max-md:flex-wrap max-md:justify-start",
            )}
          >
            {SOCIAL_TABS.map((candidate) => (
              <TabsTrigger
                key={candidate}
                className={cn(
                  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
                  "max-md:flex-none",
                )}
                data-testid={`social-posts-tab-${candidate}`}
                value={candidate}
              >
                {t(`sections.${candidate}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {actions}
      </div>

      {projectFailed && tab !== "statistics" ? (
        <SocialLoadError
          data-testid="social-project-load-error"
          kind="project"
          variant="banner"
        />
      ) : null}

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
        <SocialPostStatistics workspaceId={workspaceId} />
      </TabsContent>
      <TabsContent value="accounts">
        <SocialAccountsProjectPrompt notice={notice} />
      </TabsContent>
    </Tabs>
  );
}
