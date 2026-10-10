"use client";

import type {
  ProjectSocialConnection,
  SocialPost,
} from "@sokosumi/core-client";
import { parseAsBoolean, parseAsStringLiteral, useQueryState } from "nuqs";
import type { ReactNode } from "react";
import type { SocialTab } from "@/app/projects/components/social-posts/constants";
import { useSocialCompose } from "@/app/social/components/social-compose-context";
import { Button } from "@/components/ui/button";
import { SocialTaskHub } from "./social-task-hub";

interface SocialViewSwitcherProps {
  /** Children = the existing tab-based view (ProjectSocialPosts) */
  children: ReactNode;
  /** All posts for activity feed */
  posts: SocialPost[];
  /** Active connections */
  connections: ProjectSocialConnection[];
  /** Project name for context */
  projectName?: string | null;
  /** Available tabs */
  availableTabs: readonly SocialTab[];
}

/**
 * Feature-flagged switcher between task hub and classic tabs.
 * Defaults to classic view; ?taskHub=true switches to task hub.
 */
export function SocialViewSwitcher({
  children,
  posts,
  connections,
  projectName,
  availableTabs,
}: SocialViewSwitcherProps) {
  const [useTaskHub, setUseTaskHub] = useQueryState(
    "taskHub",
    parseAsBoolean.withDefault(false),
  );
  const [, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral<SocialTab>([
      "calendar",
      "drafts",
      "attention",
      "statistics",
      "accounts",
    ]),
  );
  const compose = useSocialCompose();

  const failedCount = posts.filter((p) =>
    ["FAILED", "MISSED"].includes(p.status),
  ).length;

  const handleCreatePost = () => {
    compose?.setOpen(true);
  };

  const handleViewCalendar = () => {
    void setTab("calendar");
    void setUseTaskHub(false);
  };

  const handleViewFailed = () => {
    void setTab("attention");
    void setUseTaskHub(false);
  };

  const handleViewPerformance = () => {
    void setTab("statistics");
    void setUseTaskHub(false);
  };

  if (!useTaskHub) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void setUseTaskHub(true)}
          >
            Try task hub
          </Button>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void setUseTaskHub(false)}
        >
          Classic view
        </Button>
      </div>
      <SocialTaskHub
        recentPosts={posts}
        failedCount={failedCount}
        onCreatePost={handleCreatePost}
        onViewSchedule={handleViewCalendar}
        onFixFailedPosts={handleViewFailed}
        onReviewPerformance={handleViewPerformance}
        projectName={projectName}
      />
    </div>
  );
}
