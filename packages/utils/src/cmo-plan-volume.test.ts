import { describe, expect, it } from "vitest";
import {
  CMO_NETWORK_VOLUME,
  CMO_SHORT_VIDEOS_PER_WEEK,
  CMO_VOLUME_LEVELS,
  type CmoVolumeLevel,
  cmoCadencePerWeek,
  cmoMonthAtLevel,
  cmoMonthFloor,
  cmoMonthTargets,
  cmoNetworkMonth,
  cmoVolumeLevelForTier,
} from "./cmo-plan-volume.js";

const day = (index: number) =>
  new Date(Date.UTC(2026, 10, 2 + index)).toISOString().slice(0, 10);

/** `perDay` pieces of one format on one network, every day for 28 days. */
function daily(
  channel: string,
  format: string,
  perDay: number,
  alsoOn?: string[],
) {
  return Array.from({ length: 28 }, (_, index) =>
    Array.from({ length: perDay }, (_, slot) => ({
      id: `${channel}-${format}-${index}-${slot}`,
      date: day(index),
      channel,
      format,
      ...(alsoOn ? { alsoOn } : {}),
    })),
  ).flat();
}

/** A month at the top rates, the way cmo-v14 writes it. */
const calendar = [
  ...daily("x", "post", 3),
  ...daily("x", "image", 3),
  ...daily("linkedin", "image", 1),
  ...daily("instagram", "carousel", 2),
  ...daily("facebook", "image", 2),
  // Seven short videos a day, each one file on TikTok, Reels and Shorts.
  ...daily("tiktok", "video", 4, ["instagram", "youtube"]),
  ...daily("instagram", "reel", 2, ["tiktok", "youtube"]),
  ...daily("youtube", "short", 1, ["tiktok", "instagram"]),
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
    expect(atLevels("facebook-")).toEqual([20, 28, 56]);
  });

  it("makes each plan's short videos once, across TikTok, Reels and Shorts", () => {
    const shortVideos = (level: CmoVolumeLevel) =>
      made(level, "tiktok-") +
      made(level, "instagram-reel-") +
      made(level, "youtube-");
    expect(CMO_VOLUME_LEVELS.map(shortVideos)).toEqual([68, 112, 196]);
    expect(
      CMO_VOLUME_LEVELS.map((level) => CMO_SHORT_VIDEOS_PER_WEEK[level] * 4),
    ).toEqual([68, 112, 196]);
  });

  it("gives each short-video network every short video at the top: 196", () => {
    for (const network of ["tiktok", "instagram", "youtube"] as const)
      expect(cmoNetworkMonth(CMO_NETWORK_VOLUME.all_in[network])).toBe(
        network === "instagram" ? 56 + 196 : 196,
      );
  });

  it("always makes what is not a social post", () => {
    for (const level of CMO_VOLUME_LEVELS) {
      const { made: ids } = cmoMonthAtLevel(calendar, level);
      expect(ids.has("ad-1") && ids.has("issue-1")).toBe(true);
    }
  });

  it("counts posts, pictures and videos, without the ad and the issue", () => {
    const top = cmoMonthAtLevel(calendar, "all_in");
    // 168 X + 28 LinkedIn + 56 Instagram + 56 Facebook + 196 short videos
    // (their copies on the other two networks are posts once split).
    expect(top.posts).toBe(504);
    expect(top.videos).toBe(196);
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

describe("cmoMonthFloor", () => {
  const everyNetwork = [
    "x",
    "linkedin",
    "instagram",
    "facebook",
    "tiktok",
    "youtube",
  ].map((channel) => ({ channel, cadence: "top rate" }));
  const floor = (level: CmoVolumeLevel, channels = everyNetwork) =>
    cmoMonthFloor(channels, level);

  it("promises each plan its networks' rates before any calendar exists", () => {
    // Starter: X 84, LinkedIn 20, Facebook 20, Instagram 28 pictures, and
    // 68 short videos on each of TikTok, Reels and Shorts.
    expect(floor("steady").total).toBe(84 + 20 + 20 + 28 + 68 * 3);
    expect(floor("active").total).toBe(112 + 28 + 28 + 28 + 112 * 3);
    expect(floor("all_in").total).toBe(168 + 28 + 56 + 56 + 196 * 3);
  });

  it("grows with every plan", () => {
    const totals = CMO_VOLUME_LEVELS.map((level) => floor(level).total);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    expect(new Set(totals).size).toBe(3);
  });

  it("matches the calendar the top plan makes in full", () => {
    // The top month above at all_in, each short video on its three networks.
    const top = cmoMonthAtLevel(calendar, "all_in");
    const shared = calendar.filter((entry) => entry.alsoOn).length;
    expect(floor("all_in").total).toBe(top.posts + shared * 2);
  });

  it("counts only the networks the strategy plans", () => {
    const two = [
      { channel: "x", cadence: "6 a day" },
      { channel: "linkedin", cadence: "1 a day" },
      { channel: "newsletter", cadence: "1 a week" },
    ];
    expect(floor("steady", two)).toEqual({
      total: 104,
      byNetwork: [
        { network: "x", posts: 84 },
        { network: "linkedin", posts: 20 },
      ],
    });
  });

  it("puts a short video on each short-video network the strategy plans", () => {
    const reels = floor("steady", [{ channel: "instagram", cadence: "" }]);
    expect(reels.byNetwork).toEqual([{ network: "instagram", posts: 28 + 68 }]);
    expect(cmoMonthTargets([{ channel: "youtube" }], "active")).toEqual({
      networks: [],
      shortVideosPerWeek: CMO_SHORT_VIDEOS_PER_WEEK.active,
      shortNetworks: ["youtube"],
    });
  });

  it("keeps a cadence the owner lowered", () => {
    const lowered = floor("all_in", [
      { channel: "x", cadence: "2 a day", setByOwner: true },
      { channel: "linkedin", cadence: "3 a week", setByOwner: true },
      // Cuso's own cadence never lowers the plan.
      { channel: "facebook", cadence: "1 a week" },
    ]);
    expect(lowered.byNetwork).toEqual([
      { network: "x", posts: 56 },
      { network: "facebook", posts: 56 },
      { network: "linkedin", posts: 12 },
    ]);
  });

  it("never raises a network past its plan's rate", () => {
    expect(
      floor("steady", [{ channel: "x", cadence: "9 a day", setByOwner: true }])
        .total,
    ).toBe(84);
  });
});

describe("cmoCadencePerWeek", () => {
  it("reads an owner's cadence as pieces a week", () => {
    expect(cmoCadencePerWeek("1 a day")).toBe(7);
    expect(cmoCadencePerWeek("3 a week, Tue Thu Sat")).toBe(3);
    expect(cmoCadencePerWeek("2 images, 7 Reels daily")).toBe(63);
    expect(cmoCadencePerWeek("often")).toBeNull();
    expect(cmoCadencePerWeek("5")).toBeNull();
  });
});
