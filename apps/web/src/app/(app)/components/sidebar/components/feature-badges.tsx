"use client";

import type {
  AnnouncedFeature,
  UserBadgeCampaigns,
} from "@sokosumi/core-client";
import { getUserBadgeCampaignsResponseTransformer } from "@sokosumi/core-client/transformers";
import { useMutation, useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  type RefObject,
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CHAT_THREADS_PATH } from "@/app/chat/utils/chat-route-base";
import { TASK_SCHEDULES_PATH } from "@/app/tasks/utils/task-schedule-view";
import { fetchBackgroundJson } from "@/components/chat/fetch-background-json";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { markBadgeCampaignSeenAction } from "@/lib/actions/badge-campaign/action";
import { SOKO_BOT_ROUTE, SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";

export type BadgeCampaignSummary = UserBadgeCampaigns["badgeCampaigns"][number];

/**
 * Where each Announced feature lives: opening any of these is opening it.
 * New task, Search and Unreads are actions, not pages; their rows report use
 * through `useMarkFeatureSeen` instead.
 */
const FEATURE_PATHS: Record<AnnouncedFeature, readonly string[]> = {
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
  return FEATURE_PATHS[feature].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

interface FeatureBadgesValue {
  userId: string;
  campaigns: Promise<BadgeCampaignSummary[]>;
  seenIds: ReadonlySet<string>;
  markSeen: (campaign: BadgeCampaignSummary) => void;
  /**
   * Pills the reader has opened, by campaign: lingering, fading, then gone.
   * Kept here because Core stops listing a campaign once it is seen, so the
   * next read would otherwise drop the pill before it has lingered.
   */
  pillExits: ReadonlyMap<string, PillExit>;
  /** The running campaigns as last read, for rows that report use on click. */
  latestCampaigns: RefObject<BadgeCampaignSummary[]>;
}

interface PillExit {
  feature: AnnouncedFeature;
  stage: "lingering" | "fading" | "gone";
}

/**
 * How long a seen pill stays after the reader lands on its feature, so it
 * goes once the new page is up rather than as the link is pressed.
 */
export const PILL_LINGER_MS = 1500;
/** The fade itself; matches `duration-200` on the pill. */
export const PILL_FADE_MS = 200;

const FeatureBadgesContext = createContext<FeatureBadgesValue | null>(null);

/**
 * Holds the reader's running Badge campaigns for the sidebar. `campaigns` is
 * an unawaited promise from the frame, so nav paints without waiting on Core
 * and only the pills suspend. Opening a feature tells Core at once; the pill
 * lingers for `PILL_LINGER_MS` once the new page is up, then fades out.
 */
export function FeatureBadgesProvider({
  userId,
  campaigns,
  children,
}: {
  userId: string;
  campaigns: Promise<BadgeCampaignSummary[]>;
  children: ReactNode;
}) {
  const [seenIds, setSeenIds] = useState<ReadonlySet<string>>(new Set());
  const [pillExits, setPillExits] = useState<ReadonlyMap<string, PillExit>>(
    new Map(),
  );
  const requestedIds = useRef(new Set<string>());
  const exitTimers = useRef(new Map<string, number[]>());
  const mounted = useRef(true);
  useMountEffect(() => {
    mounted.current = true;
    const timers = exitTimers.current;
    return () => {
      mounted.current = false;
      for (const ids of timers.values()) ids.forEach(window.clearTimeout);
      timers.clear();
    };
  });

  const scheduleExit = useCallback(({ id, feature }: BadgeCampaignSummary) => {
    if (exitTimers.current.has(id)) return;
    const setStage = (stage: PillExit["stage"]) =>
      setPillExits((current) => new Map(current).set(id, { feature, stage }));
    setStage("lingering");
    exitTimers.current.set(id, [
      window.setTimeout(() => setStage("fading"), PILL_LINGER_MS),
      window.setTimeout(() => setStage("gone"), PILL_LINGER_MS + PILL_FADE_MS),
    ]);
  }, []);

  const { mutate } = useMutation({
    mutationFn: async (campaignId: string) => {
      // A queued retry must not use another user's cookies after account switch.
      if (!mounted.current) return;
      const result = await markBadgeCampaignSeenAction(campaignId);
      if (!result.ok)
        throw new Error(
          result.error.message ?? "Failed to mark badge campaign seen",
        );
    },
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
    // Keep the optimistic hide, but allow the next poll/visit to retry after
    // prolonged failure. `mutate` handles transport rejections as well.
    onError: (_error, campaignId) => requestedIds.current.delete(campaignId),
  });
  const markSeen = useCallback(
    (campaign: BadgeCampaignSummary) => {
      // Core hears at once; the pill only leaves after it lingers.
      scheduleExit(campaign);
      if (requestedIds.current.has(campaign.id)) return;
      requestedIds.current.add(campaign.id);
      setSeenIds((current) => new Set(current).add(campaign.id));
      mutate(campaign.id);
    },
    [mutate, scheduleExit],
  );

  const latestCampaigns = useRef<BadgeCampaignSummary[]>([]);

  return (
    <FeatureBadgesContext
      value={{
        userId,
        campaigns,
        seenIds,
        markSeen,
        pillExits,
        latestCampaigns,
      }}
    >
      {children}
      <Suspense fallback={null}>
        <MarkSeenOnOpen />
      </Suspense>
    </FeatureBadgesContext>
  );
}

/** Pills and the visit observer share one user-scoped background read. */
function useCampaigns(value: FeatureBadgesValue) {
  const initial = use(value.campaigns);
  const query = useQuery({
    queryKey: ["badge-campaigns", value.userId],
    initialData: initial,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      const response = await fetchBackgroundJson(
        "/api/badge-campaigns",
        10_000,
      );
      if (signal.aborted) throw signal.reason;
      if (!response) return [];
      return (await getUserBadgeCampaignsResponseTransformer(response)).data
        .badgeCampaigns;
    },
  });
  const [clockTick, tick] = useState(0);
  const nextEnd = Math.min(
    ...query.data
      .map((campaign) => campaign.endsAt.getTime())
      .filter((end) => end > Date.now()),
  );
  useEffect(() => {
    if (!Number.isFinite(nextEnd)) return;
    const timer = window.setTimeout(
      () => tick((current) => current + 1),
      Math.min(nextEnd - Date.now(), 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [nextEnd]);
  const active = useMemo(() => {
    // A timer tick expires the data even when the browser has not fetched.
    void clockTick;
    return query.data.filter(
      (campaign) => campaign.endsAt.getTime() > Date.now(),
    );
  }, [query.data, clockTick]);
  return { ...query, data: active };
}

/** Records visits and refreshes the list on navigation, focus and polling. */
function MarkSeenOnOpen() {
  const value = use(FeatureBadgesContext);
  if (!value) throw new Error("Feature badge context missing");
  const { data: resolved, dataUpdatedAt, refetch } = useCampaigns(value);
  const pathname = usePathname();
  const lastPathname = useRef(pathname);
  useEffect(() => {
    if (lastPathname.current !== pathname) {
      lastPathname.current = pathname;
      void refetch();
    }
  }, [pathname, refetch]);
  const { markSeen, seenIds, latestCampaigns } = value;
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
  return null;
}

/**
 * For features that are actions rather than pages (New task, Search,
 * Unreads): call the returned function when the reader uses the feature.
 * Pages are left to the visit observer, so their pill counts from the moment
 * the new page is up, not from the click. Outside the provider it does nothing.
 */
export function useMarkFeatureSeen(): (feature: AnnouncedFeature) => void {
  const value = use(FeatureBadgesContext);
  return useCallback(
    (feature: AnnouncedFeature) => {
      if (FEATURE_PATHS[feature].length > 0) return;
      for (const campaign of value?.latestCampaigns.current ?? []) {
        if (campaign.feature === feature) {
          value?.markSeen(campaign);
        }
      }
    },
    [value],
  );
}

/**
 * Whether this feature's row shows the New badge: `shown`, `fading` while it
 * leaves after the reader opened the feature, or `none`.
 */
export function useNewBadgeState(
  feature: AnnouncedFeature,
): "shown" | "fading" | "none" {
  const value = use(FeatureBadgesContext);
  // Instant Nav's shell renders the sidebar outside the provider: no badge.
  const campaigns = value ? useCampaigns(value).data : [];
  const exits = [...(value?.pillExits.values() ?? [])].filter(
    (exit) => exit.feature === feature,
  );
  if (exits.some((exit) => exit.stage === "lingering")) return "shown";
  if (exits.some((exit) => exit.stage === "fading")) return "fading";
  const unopened = campaigns.some(
    (campaign) =>
      campaign.feature === feature && !value?.pillExits.has(campaign.id),
  );
  return unopened ? "shown" : "none";
}
