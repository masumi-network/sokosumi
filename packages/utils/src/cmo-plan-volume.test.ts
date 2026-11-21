import { describe, expect, it } from "vitest";
import {
  CMO_VOLUME_LEVELS,
  cmoMonthAtLevel,
  cmoVolumeLevelForTier,
} from "./cmo-plan-volume.js";

const day = (index: number) =>
  new Date(Date.UTC(2026, 10, 2 + index)).toISOString().slice(0, 10);

/** A month at the top volume: X main, Instagram and LinkedIn side, four talking videos, two ads. */
const calendar = [
  ...Array.from({ length: 28 }, (_, index) =>
    ["a", "b", "c"].map((slot, place) => ({
      id: `x-${index}-${slot}`,
      date: day(index),
      channel: "x",
      format: place === 2 ? "image" : "post",
    })),
  ).flat(),
  ...[0, 1, 2, 3].flatMap((week) =>
    [0, 2, 4].map((offset) => ({
      id: `ig-${week}-${offset}`,
      date: day(week * 7 + offset),
      channel: "instagram",
      format: "image",
    })),
  ),
  ...[0, 1, 2, 3].flatMap((week) =>
    [1, 3, 5].map((offset) => ({
      id: `li-${week}-${offset}`,
      date: day(week * 7 + offset),
      channel: "linkedin",
      format: "post",
    })),
  ),
  ...[0, 1, 2, 3].map((week) => ({
    id: `video-${week}`,
    date: day(week * 7 + 6),
    channel: "instagram",
    format: "talking_video",
  })),
  { id: "ad-1", date: day(1), channel: "google_ads", format: "search_ad" },
  { id: "ad-2", date: day(8), channel: "google_ads", format: "search_ad" },
];
const channels = [
  { channel: "x", role: "main" as const },
  { channel: "instagram", role: "side" as const },
  { channel: "linkedin", role: "side" as const },
  { channel: "google_ads" },
];

describe("cmoMonthAtLevel", () => {
  it("makes two or three posts a day on X below the top, two or three a week on a side network", () => {
    const count = (level: (typeof CMO_VOLUME_LEVELS)[number], prefix: string) =>
      [...cmoMonthAtLevel(calendar, channels, level).made].filter((id) =>
        id.startsWith(prefix),
      ).length;
    expect(CMO_VOLUME_LEVELS.map((level) => count(level, "x-"))).toEqual([
      56, 84, 84,
    ]);
    expect(CMO_VOLUME_LEVELS.map((level) => count(level, "ig-"))).toEqual([
      8, 12, 12,
    ]);
    expect(CMO_VOLUME_LEVELS.map((level) => count(level, "li-"))).toEqual([
      8, 12, 12,
    ]);
  });

  it("makes three short videos a week or one a day on each network below the top, and every one at the top", () => {
    const tiktoks = Array.from({ length: 28 }, (_, index) =>
      ["a", "b"].map((slot) => ({
        id: `tt-${index}-${slot}`,
        date: day(index),
        channel: "tiktok",
        format: "video",
      })),
    ).flat();
    const count = (level: (typeof CMO_VOLUME_LEVELS)[number]) =>
      cmoMonthAtLevel(
        [...calendar, ...tiktoks],
        [...channels, { channel: "tiktok", role: "main" as const }],
        level,
      ).videos;
    // Each level also makes the four weekly talking videos on Instagram.
    expect(CMO_VOLUME_LEVELS.map(count)).toEqual([4 + 12, 4 + 28, 4 + 56]);
  });

  it("makes five a week or one a day on a main network other than X below the top", () => {
    const linkedin = Array.from({ length: 28 }, (_, index) => ({
      id: `lim-${index}`,
      date: day(index),
      channel: "linkedin",
      format: "image",
    }));
    expect(
      CMO_VOLUME_LEVELS.map(
        (level) =>
          cmoMonthAtLevel(
            linkedin,
            [{ channel: "linkedin", role: "main" }],
            level,
          ).posts,
      ),
    ).toEqual([20, 28, 28]);
  });

  it("always makes what is not a social post", () => {
    for (const level of CMO_VOLUME_LEVELS) {
      const { made } = cmoMonthAtLevel(calendar, channels, level);
      expect(made.has("ad-1") && made.has("ad-2")).toBe(true);
    }
  });

  it("counts posts, pictures and videos, without the ads", () => {
    expect(
      CMO_VOLUME_LEVELS.map((level) => {
        const { posts, pictures, videos } = cmoMonthAtLevel(
          calendar,
          channels,
          level,
        );
        return { posts, pictures, videos };
      }),
    ).toEqual([
      // 56 X (the first two of each day, words only) + 8 Instagram + 8
      // LinkedIn + the 4 weekly videos.
      { posts: 76, pictures: 8, videos: 4 },
      { posts: 112, pictures: 40, videos: 4 },
      // Every third X post has a picture, and all twelve on Instagram.
      { posts: 112, pictures: 40, videos: 4 },
    ]);
  });

  it("only adds pieces as the level grows, and leaves skipped ones out", () => {
    const [steady, active, allIn] = CMO_VOLUME_LEVELS.map(
      (level) => cmoMonthAtLevel(calendar, channels, level).made,
    );
    if (!steady || !active || !allIn) throw new Error("levels");
    expect([...steady].every((id) => active.has(id))).toBe(true);
    expect([...active].every((id) => allIn.has(id))).toBe(true);
    const skipped = calendar.map((entry) =>
      entry.id === "x-0-a" ? { ...entry, status: "skipped" } : entry,
    );
    const { made } = cmoMonthAtLevel(skipped, channels, "steady");
    expect(made.has("x-0-a")).toBe(false);
    // The day's next post takes its place.
    expect(made.has("x-0-b")).toBe(true);
  });

  it("treats a network without a role as a main one", () => {
    expect(
      cmoMonthAtLevel(calendar, [{ channel: "x" }], "steady").made.has("x-3-a"),
    ).toBe(true);
  });
});

describe("a talking video shown on several networks", () => {
  const shared = [
    ...calendar,
    ...[0, 1, 2, 3].flatMap((week) =>
      ["youtube", "facebook"].map((network) => ({
        id: `video-${week}@${network}`,
        date: day(week * 7 + 6),
        channel: network,
        format: "talking_video",
        videoOf: `video-${week}`,
      })),
    ),
  ];

  it("counts as one video, and its posts go with it", () => {
    const steady = cmoMonthAtLevel(shared, channels, "steady");
    expect(steady.videos).toBe(4);
    expect([...steady.made].filter((id) => id.includes("@"))).toHaveLength(8);
    const allIn = cmoMonthAtLevel(shared, channels, "all_in");
    expect(allIn.videos).toBe(4);
    expect(allIn.posts).toBe(112 + 8);
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
