"use client";

import type {
  AnnouncedFeature,
  UserBadgeCampaigns,
} from "@sokosumi/core-client";
import { type RefObject, useEffect } from "react";
import { CHAT_THREADS_PATH } from "@/app/chat/utils/chat-route-base";
import { TASK_SCHEDULES_PATH } from "@/app/tasks/utils/task-schedule-view";
import { SOKO_BOT_ROUTE, SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";
import { isPathActive } from "@/lib/utils/is-path-active";

type BadgeCampaignSummary = UserBadgeCampaigns["badgeCampaigns"][number];

/**
 * Where each Announced feature lives: opening any of these is opening it.
 * New task, Search and Unreads are actions, not pages; their rows report use
 * through `useMarkFeatureSeen` instead.
 */
export const FEATURE_PATHS: Record<AnnouncedFeature, readonly string[]> = {
  SOKO_BOTS: [SOKO_BOTS_ROUTE, SOKO_BOT_ROUTE],
  NEW_TASK: [],
  SEARCH: [],
  AGENTS: ["/agents"],
  TASKS: ["/tasks"],
  SCHEDULES: [TASK_SCHEDULES_PATH],
  CONTENT_STUDIO: ["/studio"],
  SOCIAL: ["/social"],
  DRIVE: ["/drive"],
  THREADS: [CHAT_THREADS_PATH],
  UNREADS: [],
};

function isFeatureOpen(feature: AnnouncedFeature, pathname: string) {
  return FEATURE_PATHS[feature].some((path) => isPathActive(pathname, path));
}

interface UseFeatureBadgesMarkSeenOnOpenOptions {
  resolved: BadgeCampaignSummary[];
  dataUpdatedAt: number;
  pathname: string;
  markSeen: (campaign: BadgeCampaignSummary) => void;
  seenIds: ReadonlySet<string>;
  latestCampaigns: RefObject<BadgeCampaignSummary[]>;
}

/**
 * Keeps `latestCampaigns` synced with the active campaigns and marks any
 * visited or already-seen campaign seen for `MarkSeenOnOpen`.
 */
export function useFeatureBadgesMarkSeenOnOpen({
  resolved,
  dataUpdatedAt,
  pathname,
  markSeen,
  seenIds,
  latestCampaigns,
}: UseFeatureBadgesMarkSeenOnOpenOptions): void {
  useEffect(() => {
    latestCampaigns.current = resolved;
    for (const campaign of resolved) {
      if (
        isFeatureOpen(campaign.feature, pathname) ||
        seenIds.has(campaign.id)
      ) {
        markSeen(campaign);
      }
    }
  }, [resolved, dataUpdatedAt, pathname, markSeen, seenIds, latestCampaigns]);
}
