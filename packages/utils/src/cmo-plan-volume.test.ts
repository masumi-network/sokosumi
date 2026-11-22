import { describe, expect, it } from "vitest";
import {
  CMO_NETWORK_VOLUME,
  CMO_VOLUME_LEVELS,
  type CmoVolumeLevel,
  cmoMonthAtLevel,
  cmoNetworkMonth,
  cmoVolumeLevelForTier,
} from "./cmo-plan-volume.js";

const day = (index: number) =>
  new Date(Date.UTC(2026, 10, 2 + index)).toISOString().slice(0, 10);

/** `perDay` pieces of one format on one network, every day for 28 days. */
function daily(channel: string, format: string, perDay: number) {
  return Array.from({ length: 28 }, (_, index) =>
    Array.from({ length: perDay }, (_, slot) => ({
      id: `${channel}-${format}-${index}-${slot}`,
      date: day(index),
      channel,
      format,
    })),
  ).flat();
}

/** A month at the top rates, the way cmo-v14 writes it. */
const calendar = [
  ...daily("x", "post", 3),
  ...daily("x", "image", 3),
  ...daily("linkedin", "image", 1),
  ...daily("instagram", "carousel", 2),
  ...daily("instagram", "reel", 2),
  ...daily("facebook", "image", 2),
  ...daily("tiktok", "video", 3),
  ...daily("youtube", "short", 2),
  { id: "ad-1", date: day(1), channel: "google_ads", format: "search_ad" },
  { id: "issue-1", date: day(3), channel: "newsletter", format: "issue" },
];

const made = (level: CmoVolumeLevel, prefix: string) =>
  [...cmoMonthAtLevel(calendar, level).made].filter((id) =>
    id.startsWith(prefix),
  ).length;

const atLevels = (prefix: string) =>
  CMO_VOLUME_LEVELS.map((level) => made(level, prefix));

describe("cmoMonthAtLevel", () => {
  it("makes each network at its plan's rate: Starter, Growth, Scale", () => {
    expect(atLevels("x-")).toEqual([84, 112, 168]);
    expect(atLevels("linkedin-")).toEqual([20, 28, 28]);
    expect(atLevels("instagram-carousel-")).toEqual([28, 28, 56]);
    expect(atLevels("instagram-reel-")).toEqual([20, 28, 56]);
    expect(atLevels("facebook-")).toEqual([20, 28, 56]);
    expect(atLevels("tiktok-")).toEqual([28, 56, 84]);
    expect(atLevels("youtube-")).toEqual([20, 28, 56]);
  });

  it("matches the table, so the top plan makes the whole top month", () => {
    for (const [network, rate] of Object.entries(CMO_NETWORK_VOLUME.all_in)) {
      expect(made("all_in", `${network}-`)).toBe(cmoNetworkMonth(rate));
    }
  });

  it("always makes what is not a social post", () => {
    for (const level of CMO_VOLUME_LEVELS) {
      const { made: ids } = cmoMonthAtLevel(calendar, level);
      expect(ids.has("ad-1") && ids.has("issue-1")).toBe(true);
    }
  });

  it("counts posts, pictures and videos, without the ad and the issue", () => {
    const top = cmoMonthAtLevel(calendar, "all_in");
    // 168 X + 28 LinkedIn + 112 Instagram + 56 Facebook + 84 TikTok + 56 YouTube.
    expect(top.posts).toBe(504);
    expect(top.videos).toBe(56 + 84 + 56);
    expect(top.pictures).toBe(84 + 28 + 56 + 56);
  });

  it("only adds pieces as the level grows, and leaves skipped ones out", () => {
    const [steady, active, allIn] = CMO_VOLUME_LEVELS.map(
      (level) => cmoMonthAtLevel(calendar, level).made,
    );
    if (!steady || !active || !allIn) throw new Error("levels");
    expect([...steady].every((id) => active.has(id))).toBe(true);
    expect([...active].every((id) => allIn.has(id))).toBe(true);
    const skipped = calendar.map((entry) =>
      entry.id === "x-post-0-0" ? { ...entry, status: "skipped" } : entry,
    );
    const { made: ids } = cmoMonthAtLevel(skipped, "steady");
    expect(ids.has("x-post-0-0")).toBe(false);
    // The day's next post takes its place.
    expect(ids.has("x-image-0-0")).toBe(true);
  });
});

describe("a talking video shown on several networks", () => {
  const video = {
    id: "talk-0",
    date: day(6),
    channel: "instagram",
    format: "talking_video",
  };
  const shared = [
    video,
    ...["youtube", "tiktok"].map((network) => ({
      id: `talk-0@${network}`,
      date: day(6),
      channel: network,
      format: "talking_video",
      videoOf: "talk-0",
    })),
  ];

  it("counts as one video, and its posts go with it", () => {
    const steady = cmoMonthAtLevel(shared, "steady");
    expect(steady.videos).toBe(1);
    expect(steady.posts).toBe(3);
    expect([...steady.made].sort()).toEqual([
      "talk-0",
      "talk-0@tiktok",
      "talk-0@youtube",
    ]);
  });
});

describe("cmoVolumeLevelForTier", () => {
  it("makes more of the month on a bigger plan, and all of it otherwise", () => {
    expect(
      ["starter", "Growth", "scale", null, "enterprise"].map(
        cmoVolumeLevelForTier,
      ),
    ).toEqual(["steady", "active", "all_in", "all_in", "all_in"]);
  });
});
