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
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchBackgroundJson } from "@/components/chat/fetch-background-json";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { markBadgeCampaignSeenAction } from "@/lib/actions/badge-campaign/action";
import { SOKO_BOT_ROUTE, SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";

export type BadgeCampaignSummary = UserBadgeCampaigns["badgeCampaigns"][number];

/** Where each Announced feature lives: opening any of these is opening it. */
const FEATURE_PATHS: Record<AnnouncedFeature, readonly string[]> = {
  SOKO_BOTS: [SOKO_BOTS_ROUTE, SOKO_BOT_ROUTE],
  CONTENT_STUDIO: ["/studio"],
  SOCIAL: ["/social"],
  DRIVE: ["/drive"],
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
  markSeen: (campaignId: string) => void;
}

const FeatureBadgesContext = createContext<FeatureBadgesValue | null>(null);

/**
 * Holds the reader's running Badge campaigns for the sidebar. `campaigns` is
 * an unawaited promise from the frame, so nav paints without waiting on Core
 * and only the pills suspend. Seen state is kept here as well as in Core, so
 * a pill drops the moment the reader opens its feature.
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
  const requestedIds = useRef(new Set<string>());
  const mounted = useRef(true);
  useMountEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  });

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
    (campaignId: string) => {
      if (requestedIds.current.has(campaignId)) return;
      requestedIds.current.add(campaignId);
      setSeenIds((current) => new Set(current).add(campaignId));
      mutate(campaignId);
    },
    [mutate],
  );

  return (
    <FeatureBadgesContext value={{ userId, campaigns, seenIds, markSeen }}>
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
  const { markSeen, seenIds } = value;
  useEffect(() => {
    for (const campaign of resolved) {
      if (
        isFeatureOpen(campaign.feature, pathname) ||
        seenIds.has(campaign.id)
      ) {
        markSeen(campaign.id);
      }
    }
  }, [resolved, dataUpdatedAt, pathname, markSeen, seenIds]);
  return null;
}

/** True while the reader should see the New badge on this feature's row. */
export function useHasNewBadge(feature: AnnouncedFeature): boolean {
  const value = use(FeatureBadgesContext);
  // Instant Nav's shell renders the sidebar outside the provider: no badge.
  const campaigns = value ? useCampaigns(value).data : [];
  return campaigns.some(
    (campaign) =>
      campaign.feature === feature && !value?.seenIds.has(campaign.id),
  );
}
