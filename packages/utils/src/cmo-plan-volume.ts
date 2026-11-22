import { CMO_CHANNELS } from "./cmo-channels.js";

/**
 * How much of a month a CMO plan makes. Cuso writes every strategy at the top
 * volume; the plan the owner buys decides how much of it is made, and a
 * bigger plan makes more of the same month. The levels are the paces a
 * strategy already knows, from the smallest plan up.
 */
export const CMO_VOLUME_LEVELS = ["steady", "active", "all_in"] as const;
export type CmoVolumeLevel = (typeof CMO_VOLUME_LEVELS)[number];

/** The social networks a CMO plan sets a rate for. */
export type CmoVolumeNetwork =
  | "x"
  | "linkedin"
  | "instagram"
  | "facebook"
  | "tiktok"
  | "youtube";

/**
 * One network's rate at a plan: `posts` a day or a week (X counts a day,
 * its feed moves fastest), and on the short-video networks (TikTok,
 * Instagram Reels, YouTube Shorts) `videos` a week: the plan's short videos,
 * each made once and posted on all three (`alsoOn`), so the three share one
 * count. Without `videos` a video counts as one of the posts.
 */
export interface CmoNetworkRate {
  posts: number;
  per: "day" | "week";
  videos?: number;
}

/**
 * Short videos a week each plan makes, each one file posted to TikTok,
 * Instagram Reels and YouTube Shorts together (owner, 2026-11-22): as many
 * videos as before (68, 112 and 196 a month), so each network gets about
 * three times its short videos and the media cost stays.
 */
export const CMO_SHORT_VIDEOS_PER_WEEK: Record<CmoVolumeLevel, number> = {
  steady: 17,
  active: 28,
  all_in: 49,
};

/**
 * What each plan makes per network (owner, 2026-11-21: "more on every plan,
 * the top truly over the top"). Cuso writes every strategy at all_in (Scale
 * and Tester credits make all of it); Starter and Growth make their share.
 */
export const CMO_NETWORK_VOLUME: Record<
  CmoVolumeLevel,
  Record<CmoVolumeNetwork, CmoNetworkRate>
> = {
  steady: {
    x: { posts: 3, per: "day" },
    linkedin: { posts: 5, per: "week" },
    instagram: {
      posts: 7,
      per: "week",
      videos: CMO_SHORT_VIDEOS_PER_WEEK.steady,
    },
    facebook: { posts: 5, per: "week" },
    tiktok: { posts: 0, per: "week", videos: CMO_SHORT_VIDEOS_PER_WEEK.steady },
    youtube: {
      posts: 0,
      per: "week",
      videos: CMO_SHORT_VIDEOS_PER_WEEK.steady,
    },
  },
  active: {
    x: { posts: 4, per: "day" },
    linkedin: { posts: 7, per: "week" },
    instagram: {
      posts: 7,
      per: "week",
      videos: CMO_SHORT_VIDEOS_PER_WEEK.active,
    },
    facebook: { posts: 7, per: "week" },
    tiktok: { posts: 0, per: "week", videos: CMO_SHORT_VIDEOS_PER_WEEK.active },
    youtube: {
      posts: 0,
      per: "week",
      videos: CMO_SHORT_VIDEOS_PER_WEEK.active,
    },
  },
  all_in: {
    x: { posts: 6, per: "day" },
    linkedin: { posts: 7, per: "week" },
    instagram: {
      posts: 14,
      per: "week",
      videos: CMO_SHORT_VIDEOS_PER_WEEK.all_in,
    },
    facebook: { posts: 14, per: "week" },
    tiktok: { posts: 0, per: "week", videos: CMO_SHORT_VIDEOS_PER_WEEK.all_in },
    youtube: {
      posts: 0,
      per: "week",
      videos: CMO_SHORT_VIDEOS_PER_WEEK.all_in,
    },
  },
};

/** A network's pieces in a 28-day month at a plan. */
export function cmoNetworkMonth(rate: CmoNetworkRate): number {
  return rate.posts * (rate.per === "day" ? 28 : 4) + (rate.videos ?? 0) * 4;
}

interface VolumeEntry {
  id: string;
  date: string;
  channel: string;
  format: string;
  status?: string;
  /** A talking video's post on another network: it goes with its video. */
  videoOf?: string;
}

export interface CmoMonthVolume {
  /** The entries this level makes, by id. */
  made: ReadonlySet<string>;
  posts: number;
  pictures: number;
  videos: number;
}

type Format = { image?: boolean; video?: boolean };

function channelOf(key: string) {
  return (
    CMO_CHANNELS as Record<
      string,
      { owner: string; formats: Record<string, Format> }
    >
  )[key.toLowerCase()];
}

const DAY_MS = 86_400_000;

/**
 * The part of a month a level makes. The top level makes all of it. A piece
 * that is not a social post (an ad, a newsletter issue) is always made: ads
 * follow the owner's budget and a newsletter its list. The earliest pieces
 * are kept, so a bigger plan adds to the month and never swaps a piece.
 */
export function cmoMonthAtLevel(
  calendar: readonly VolumeEntry[],
  level: CmoVolumeLevel,
): CmoMonthVolume {
  const live = calendar
    .filter((entry) => entry.status !== "skipped")
    .toSorted((a, b) => a.date.localeCompare(b.date));
  const start = Date.parse(live[0]?.date ?? "");
  const rates =
    level === "all_in"
      ? null
      : (CMO_NETWORK_VOLUME[level] as Record<string, CmoNetworkRate>);
  const made = new Set<string>();
  const taken = new Map<string, number>();
  const take = (slot: string, most: number, entry: VolumeEntry) => {
    const count = taken.get(slot) ?? 0;
    if (count >= most) return;
    taken.set(slot, count + 1);
    made.add(entry.id);
  };
  let [posts, pictures, videos] = [0, 0, 0];
  // A shared video's posts follow it, after every other piece is decided.
  const copies = live.filter((entry) => entry.videoOf);
  for (const entry of live.filter((item) => !item.videoOf)) {
    const key = entry.channel.toLowerCase();
    const channel = channelOf(key);
    const format = channel?.formats[entry.format];
    const week = Math.floor((Date.parse(entry.date) - start) / DAY_MS / 7);
    const rate = rates?.[key];
    if (!rate || channel?.owner !== "connect") {
      made.add(entry.id);
    } else if (format?.video && rate.videos !== undefined) {
      // One count for the three: each short video goes out on all of them.
      take(`short-video:${week}`, rate.videos, entry);
    } else if (rate.per === "day") {
      take(`${key}:${entry.date}`, rate.posts, entry);
    } else {
      take(`${key}:week:${week}`, rate.posts, entry);
    }
    if (!made.has(entry.id)) continue;
    if (channel?.owner === "connect") posts += 1;
    if (format?.video) videos += 1;
    else if (format?.image) pictures += 1;
  }
  for (const copy of copies) {
    if (!copy.videoOf || !made.has(copy.videoOf)) continue;
    made.add(copy.id);
    posts += 1;
  }
  return { made, posts, pictures, videos };
}

/**
 * The level a CMO plan makes, by its tier: Starter and Growth their rates in
 * `CMO_NETWORK_VOLUME`, Scale the whole month. Tester credits and a tier
 * this build does not know make the whole month.
 */
export function cmoVolumeLevelForTier(tier: string | null): CmoVolumeLevel {
  const level = TIER_LEVELS[tier?.trim().toLowerCase() ?? ""];
  return level ?? "all_in";
}

const TIER_LEVELS: Record<string, CmoVolumeLevel> = {
  starter: "steady",
  growth: "active",
  scale: "all_in",
};
