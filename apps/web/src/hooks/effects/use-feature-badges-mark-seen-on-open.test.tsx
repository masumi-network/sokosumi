import type { UserBadgeCampaigns } from "@sokosumi/core-client";
import { render } from "@testing-library/react";
import { type RefObject, useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { useFeatureBadgesMarkSeenOnOpen } from "./use-feature-badges-mark-seen-on-open";

type BadgeCampaignSummary = UserBadgeCampaigns["badgeCampaigns"][number];

const DRIVE_CAMPAIGN: BadgeCampaignSummary = {
  id: "campaign-drive",
  feature: "DRIVE",
  endsAt: new Date("2026-10-22T00:00:00.000Z"),
};

const SEARCH_CAMPAIGN: BadgeCampaignSummary = {
  id: "campaign-search",
  feature: "SEARCH",
  endsAt: new Date("2026-10-22T00:00:00.000Z"),
};

describe("useFeatureBadgesMarkSeenOnOpen", () => {
  it("syncs latestCampaigns in passive phase and marks open or already-seen campaigns", () => {
    const markSeen = vi.fn();
    const latestCampaigns: RefObject<BadgeCampaignSummary[]> = { current: [] };
    const layoutSnapshot: BadgeCampaignSummary[][] = [];
    const resolved = [DRIVE_CAMPAIGN, SEARCH_CAMPAIGN];
    const emptySeen = new Set<string>();

    function Probe({
      pathname,
      dataUpdatedAt,
      seenIds,
    }: {
      pathname: string;
      dataUpdatedAt: number;
      seenIds: ReadonlySet<string>;
    }) {
      useFeatureBadgesMarkSeenOnOpen({
        resolved,
        dataUpdatedAt,
        pathname,
        markSeen,
        seenIds,
        latestCampaigns,
      });
      useLayoutEffect(() => {
        layoutSnapshot.push([...latestCampaigns.current]);
      }, []);
      return null;
    }

    // Prefix-only match "/drivers" does not open DRIVE, and action features never match by route.
    const { rerender } = render(
      <Probe pathname="/drivers" dataUpdatedAt={100} seenIds={emptySeen} />,
    );
    expect(layoutSnapshot).toEqual([[]]);
    expect(latestCampaigns.current).toBe(resolved);
    expect(markSeen).not.toHaveBeenCalled();

    // Opening a nested route under /drive marks the DRIVE campaign seen.
    rerender(
      <Probe
        pathname="/drive/folder-1"
        dataUpdatedAt={100}
        seenIds={emptySeen}
      />,
    );
    expect(markSeen).toHaveBeenCalledTimes(1);
    expect(markSeen).toHaveBeenLastCalledWith(DRIVE_CAMPAIGN);

    // Navigating away while the campaign id is in seenIds still marks it seen on refresh.
    const seenDrive = new Set([DRIVE_CAMPAIGN.id]);
    rerender(
      <Probe pathname="/tasks" dataUpdatedAt={100} seenIds={seenDrive} />,
    );
    expect(markSeen).toHaveBeenCalledTimes(2);
    expect(markSeen).toHaveBeenLastCalledWith(DRIVE_CAMPAIGN);

    // Updating dataUpdatedAt re-runs the effect even when resolved keeps the same reference.
    rerender(
      <Probe pathname="/tasks" dataUpdatedAt={200} seenIds={seenDrive} />,
    );
    expect(markSeen).toHaveBeenCalledTimes(3);
    expect(markSeen).toHaveBeenLastCalledWith(DRIVE_CAMPAIGN);
  });
});
