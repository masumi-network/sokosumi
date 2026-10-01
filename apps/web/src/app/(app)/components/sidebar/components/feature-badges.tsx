"use client";

import type { AnnouncedFeature } from "@sokosumi/core-client";
import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  Suspense,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { markBadgeCampaignSeenAction } from "@/lib/actions/badge-campaign/action";
import { SOKO_BOT_ROUTE, SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";

export interface BadgeCampaignSummary {
  id: string;
  feature: AnnouncedFeature;
}

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
  campaigns,
  children,
}: {
  campaigns: Promise<BadgeCampaignSummary[]>;
  children: ReactNode;
}) {
  const [seenIds, setSeenIds] = useState<ReadonlySet<string>>(new Set());
  const requestedIds = useRef(new Set<string>());

  const markSeen = useCallback((campaignId: string) => {
    if (requestedIds.current.has(campaignId)) {
      return;
    }
    requestedIds.current.add(campaignId);
    setSeenIds((current) => new Set(current).add(campaignId));
    void markBadgeCampaignSeenAction(campaignId);
  }, []);

  return (
    <FeatureBadgesContext value={{ campaigns, seenIds, markSeen }}>
      {children}
      <Suspense fallback={null}>
        <MarkSeenOnOpen campaigns={campaigns} markSeen={markSeen} />
      </Suspense>
    </FeatureBadgesContext>
  );
}

/** Records a campaign as seen when the reader is on its feature. */
function MarkSeenOnOpen({
  campaigns,
  markSeen,
}: Pick<FeatureBadgesValue, "campaigns" | "markSeen">) {
  const resolved = use(campaigns);
  const pathname = usePathname();

  useEffect(() => {
    for (const campaign of resolved) {
      if (isFeatureOpen(campaign.feature, pathname)) {
        markSeen(campaign.id);
      }
    }
  }, [resolved, pathname, markSeen]);

  return null;
}

/** True while the reader should see the New badge on this feature's row. */
export function useHasNewBadge(feature: AnnouncedFeature): boolean {
  const value = use(FeatureBadgesContext);
  // Instant Nav's shell renders the sidebar outside the provider: no badge.
  const campaigns = value ? use(value.campaigns) : [];
  return campaigns.some(
    (campaign) =>
      campaign.feature === feature && !value?.seenIds.has(campaign.id),
  );
}
