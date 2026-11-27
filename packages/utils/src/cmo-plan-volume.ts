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
  /**
   * The month's first day, when it is fixed (cmo-v22: Core writes the month
   * from it); otherwise the first piece's day.
   */
  monthStart?: string,
): CmoMonthVolume {
  const live = calendar
    .filter((entry) => entry.status !== "skipped")
    .toSorted((a, b) => a.date.localeCompare(b.date));
  const start = Date.parse(monthStart ?? live[0]?.date ?? "");
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

/** A strategy's channel as the month's targets read it. */
export interface CmoTargetChannel {
  channel: string;
  cadence?: string;
  /** The owner asked for this lower cadence: it caps the plan's rate. */
  setByOwner?: boolean;
}

/** What one network makes in a month at a plan, short videos apart. */
export interface CmoNetworkTarget {
  network: CmoVolumeNetwork;
  /** Posts a day (X) or a week (the rest). */
  rate: number;
  per: "day" | "week";
}

/** What a month holds at a plan, from its networks alone (cmo-v22). */
export interface CmoMonthTargets {
  networks: CmoNetworkTarget[];
  /** Short videos a week, each one entry posted on every `shortNetworks`. */
  shortVideosPerWeek: number;
  shortNetworks: CmoVolumeNetwork[];
}

const SHORT_NETWORKS: readonly CmoVolumeNetwork[] = [
  "tiktok",
  "instagram",
  "youtube",
];

/**
 * Pieces a week an owner's cadence asks for ("1 a day", "3 a week, Tue Thu
 * Sat"); null when it names no number or no day or week.
 */
export function cmoCadencePerWeek(cadence: string): number | null {
  const numbers = [...cadence.matchAll(/\d+/g)].map((match) =>
    Number(match[0]),
  );
  if (numbers.length === 0) return null;
  const total = numbers.reduce((sum, value) => sum + value, 0);
  if (/\b(day|daily)\b/i.test(cadence)) return total * 7;
  if (/\b(week|weekly)\b/i.test(cadence)) return total;
  return null;
}

/**
 * The month a plan makes of a strategy's networks, at each network's rate
 * in `CMO_NETWORK_VOLUME`: what Core writes after payment (cmo-v22), so it is
 * known before any calendar exists. A cadence the owner lowered caps its
 * network; a network the strategy leaves out makes nothing.
 */
export function cmoMonthTargets(
  channels: readonly CmoTargetChannel[],
  level: CmoVolumeLevel,
): CmoMonthTargets {
  const rates = CMO_NETWORK_VOLUME[level] as Record<string, CmoNetworkRate>;
  const planned = new Map<CmoVolumeNetwork, CmoTargetChannel>();
  for (const channel of channels) {
    const key = channel.channel.toLowerCase();
    if (rates[key]) planned.set(key as CmoVolumeNetwork, channel);
  }
  const ownerCap = (channel: CmoTargetChannel) =>
    channel.setByOwner && channel.cadence
      ? cmoCadencePerWeek(channel.cadence)
      : null;
  const networks: CmoNetworkTarget[] = [];
  for (const [network, channel] of planned) {
    const rate = rates[network]!;
    if (rate.posts === 0) continue;
    const cap = ownerCap(channel);
    const perWeek = rate.posts * (rate.per === "day" ? 7 : 1);
    if (cap === null || cap >= perWeek) {
      networks.push({ network, rate: rate.posts, per: rate.per });
    } else if (cap > 0) {
      networks.push(
        rate.per === "day" && cap % 7 === 0
          ? { network, rate: cap / 7, per: "day" }
          : { network, rate: cap, per: "week" },
      );
    }
  }
  const shortNetworks = SHORT_NETWORKS.filter((network) =>
    planned.has(network),
  );
  const caps = shortNetworks
    .map((network) => ownerCap(planned.get(network)!))
    .filter((cap): cap is number => cap !== null);
  const shortVideosPerWeek =
    shortNetworks.length === 0
      ? 0
      : Math.min(CMO_SHORT_VIDEOS_PER_WEEK[level], ...caps);
  return { networks, shortVideosPerWeek, shortNetworks };
}

/** A network's posts in a 28-day month at its target. */
function targetMonth(target: CmoNetworkTarget): number {
  return target.rate * (target.per === "day" ? 28 : 4);
}

/**
 * The posts a plan promises a month before any calendar exists (cmo-v22):
 * each network at its rate, and each short video once on every network it
 * goes out on. A talking video's copies on other networks come on top.
 */
export function cmoMonthFloor(
  channels: readonly CmoTargetChannel[],
  level: CmoVolumeLevel,
): {
  total: number;
  byNetwork: { network: CmoVolumeNetwork; posts: number }[];
} {
  const targets = cmoMonthTargets(channels, level);
  const counts = new Map<CmoVolumeNetwork, number>();
  for (const target of targets.networks)
    counts.set(target.network, targetMonth(target));
  for (const network of targets.shortNetworks)
    counts.set(
      network,
      (counts.get(network) ?? 0) + targets.shortVideosPerWeek * 4,
    );
  const byNetwork = [...counts]
    .map(([network, posts]) => ({ network, posts }))
    .filter(({ posts }) => posts > 0)
    .sort((a, b) => b.posts - a.posts);
  return {
    total: byNetwork.reduce((sum, { posts }) => sum + posts, 0),
    byNetwork,
  };
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
