import { CMO_CHANNELS } from "./cmo-channels.js";

/**
 * How much of a month a CMO plan makes. Cuso writes every strategy at the top
 * volume; the plan the owner buys decides how much of it is made, and a
 * bigger plan makes more of the same month. The levels are the paces a
 * strategy already knows, from the smallest plan up.
 */
export const CMO_VOLUME_LEVELS = ["steady", "active", "all_in"] as const;
export type CmoVolumeLevel = (typeof CMO_VOLUME_LEVELS)[number];

/** Posts a day on a main network; X's feed moves fastest. */
const MAIN_PER_DAY: Record<CmoVolumeLevel, { x: number; other: number }> = {
  steady: { x: 1, other: 1 },
  active: { x: 2, other: 2 },
  all_in: { x: 3, other: 2 },
};
/** Posts a week on a side network, or one the business has no account on yet. */
const SIDE_PER_WEEK: Record<CmoVolumeLevel, number> = {
  steady: 1,
  active: 2,
  all_in: 3,
};
/** Videos a month, talking or moving: each costs as much as many pictures. */
const VIDEOS_PER_MONTH: Record<CmoVolumeLevel, number> = {
  steady: 1,
  active: 2,
  all_in: 4,
};

interface VolumeEntry {
  id: string;
  date: string;
  channel: string;
  format: string;
  status?: string;
  /** A talking video's post on another network: it goes with its video. */
  videoOf?: string;
}

interface VolumeChannel {
  channel: string;
  role?: "main" | "side";
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
 * The part of a month a level makes. A piece that is not a social post (an
 * ad, a newsletter issue) is always made: ads follow the owner's budget and
 * a newsletter its list. Videos are counted across the month, whatever
 * network they start on; the earliest ones are kept, so a bigger plan adds
 * to the month and never swaps a piece.
 */
export function cmoMonthAtLevel(
  calendar: readonly VolumeEntry[],
  channels: readonly VolumeChannel[],
  level: CmoVolumeLevel,
): CmoMonthVolume {
  const live = calendar
    .filter((entry) => entry.status !== "skipped")
    .toSorted((a, b) => a.date.localeCompare(b.date));
  const start = Date.parse(live[0]?.date ?? "");
  const roles = new Map(
    channels.map((channel) => [channel.channel.toLowerCase(), channel.role]),
  );
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
    if (channel?.owner !== "connect") {
      made.add(entry.id);
    } else if (format?.video) {
      take("video", VIDEOS_PER_MONTH[level], entry);
    } else if (roles.get(key) === "side") {
      const week = Math.floor((Date.parse(entry.date) - start) / DAY_MS / 7);
      take(`${key}:week:${week}`, SIDE_PER_WEEK[level], entry);
    } else {
      const perDay = MAIN_PER_DAY[level];
      take(
        `${key}:${entry.date}`,
        key === "x" ? perDay.x : perDay.other,
        entry,
      );
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
 * The level a CMO plan makes, by its tier: Starter one post a day on a main
 * network, Growth two, Scale up to three. Tester credits and a tier this
 * build does not know make the whole month.
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
