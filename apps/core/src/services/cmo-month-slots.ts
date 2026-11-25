import type {
  CmoCalendarEntry,
  MarketingStrategyPlan,
} from "@sokosumi/soko-bot";
import {
  CMO_CHANNELS,
  CMO_NETWORK_VOLUME,
  type CmoVolumeLevel,
  type CmoVolumeNetwork,
  cmoMonthTargets,
  cmoShortVideoFormat,
  isCmoShortVideoFormat,
  isCmoTalkingFormat,
} from "@sokosumi/utils";

/**
 * The month Core writes for a cmo-v22 strategy, before any words: every
 * post's day, time, network, format, pillar, approach and funnel step.
 * Core decides them, so the month holds the plan's rates and its pillar and
 * mix shares by construction; the model only writes what each post says.
 */

type Approach = NonNullable<CmoCalendarEntry["approach"]>;
type Stage = NonNullable<CmoCalendarEntry["stage"]>;

export interface CmoMonthSlot {
  id: string;
  date: string;
  time: string;
  channel: string;
  format: string;
  alsoOn?: string[];
  pillar: string;
  approach: Approach;
  stage: Stage;
  /** What the post builds on: a research item or a Brand Brain fact. */
  seed?: string;
}

/** A month is four weeks: what a plan's rates are counted over. */
export const CMO_MONTH_DAYS = 28;
/** Talking videos a month at each plan (owner, 2026-11-25: four on every plan). */
export const CMO_MONTH_TALKING_VIDEOS: Record<CmoVolumeLevel, number> = {
  steady: 4,
  active: 4,
  all_in: 4,
};

const DAY_MS = 86_400_000;

/**
 * Each network's picture-led formats in turn: X one in two with a picture
 * (cmo-v14 asks at least 0.4), LinkedIn at most one in four words only.
 */
const FORMAT_TURNS: Record<string, readonly string[]> = {
  x: ["image", "post", "image", "reply", "image", "post"],
  linkedin: ["image", "images", "post", "image"],
  facebook: ["image", "link", "image", "image"],
  instagram: ["carousel", "image", "quote_card", "image"],
};

/** A network's weekly video beside its pictures, when it has no short-video slot. */
const WEEKLY_VIDEO: Partial<Record<string, string>> = { facebook: "reel" };

/** Where a network's audience reads, in the owner's time: a few slots a day. */
const TIMES: Record<string, readonly string[]> = {
  x: ["08:30", "10:30", "12:30", "15:00", "17:30", "20:00", "07:30", "13:30"],
  linkedin: ["09:00", "12:00"],
  facebook: ["11:00", "18:30", "14:00"],
  instagram: ["12:00", "19:00", "09:00"],
  short: [
    "07:00",
    "09:30",
    "11:30",
    "13:30",
    "16:00",
    "18:00",
    "20:30",
    "08:30",
    "15:00",
  ],
};

/** The networks a talking video leads on, first planned first. */
const TALKING_LEADS: readonly string[] = [
  "linkedin",
  "instagram",
  "facebook",
  "youtube",
  "tiktok",
];

/**
 * The funnel steps each approach serves (cmo-v20: every network carries
 * every step; most posts help people find out and look, fewer ask).
 */
const STAGE_WEIGHTS: Record<Approach, Partial<Record<Stage, number>>> = {
  educational: { awareness: 6, interest: 4 },
  "thought-leadership": { awareness: 7, interest: 3 },
  "problem-solution": { awareness: 4, interest: 6 },
  "product-led": { interest: 6, desire: 4 },
  "social-proof": { desire: 1 },
  "people-led": { awareness: 6, interest: 4 },
  "community-led": { awareness: 7, interest: 3 },
  entertainment: { awareness: 1 },
  "research-led": { awareness: 6, interest: 4 },
  promotional: { action: 1 },
};

function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

function dayIndex(start: string, date: string): number {
  return Math.round((Date.parse(date) - Date.parse(start)) / DAY_MS);
}

function formatsOf(channel: string): Record<string, { video?: boolean }> {
  return (
    (
      CMO_CHANNELS as Record<
        string,
        { formats: Record<string, { video?: boolean }> }
      >
    )[channel]?.formats ?? {}
  );
}

/**
 * Exact counts for `total` items from weights, by largest remainder, after
 * what `have` already holds: the shares come out whole and add up.
 */
export function cmoQuota(
  weights: ReadonlyMap<string, number>,
  total: number,
  have: ReadonlyMap<string, number> = new Map(),
): Map<string, number> {
  const sum = [...weights.values()].reduce((left, right) => left + right, 0);
  const quota = new Map<string, number>();
  if (sum <= 0 || total <= 0) return quota;
  const whole = total + [...have.values()].reduce((a, b) => a + b, 0);
  const exact = [...weights].map(([key, weight]) => {
    const target = (weight / sum) * whole - (have.get(key) ?? 0);
    return { key, target: Math.max(0, target) };
  });
  const scale = exact.reduce((acc, item) => acc + item.target, 0);
  const wanted = exact.map((item) => ({
    key: item.key,
    target: scale > 0 ? (item.target / scale) * total : total / exact.length,
  }));
  let left = total;
  for (const item of wanted) {
    const count = Math.floor(item.target);
    quota.set(item.key, count);
    left -= count;
  }
  for (const item of wanted
    .toSorted(
      (a, b) =>
        b.target - Math.floor(b.target) - (a.target - Math.floor(a.target)),
    )
    .slice(0, left))
    quota.set(item.key, (quota.get(item.key) ?? 0) + 1);
  return quota;
}

/**
 * Hands out keys by their quotas in an even order (smooth weighted
 * round-robin), so a pillar's posts spread over the weeks instead of
 * landing in a block.
 */
export function cmoSpread(quota: ReadonlyMap<string, number>): string[] {
  const keys = [...quota].filter(([, count]) => count > 0);
  const total = keys.reduce((sum, [, count]) => sum + count, 0);
  const current = new Map(keys.map(([key]) => [key, 0]));
  const left = new Map(keys);
  const order: string[] = [];
  for (let index = 0; index < total; index++) {
    let best: string | null = null;
    for (const [key, count] of keys) {
      if ((left.get(key) ?? 0) <= 0) continue;
      current.set(key, (current.get(key) ?? 0) + count);
      if (best === null || (current.get(key) ?? 0) > (current.get(best) ?? 0))
        best = key;
    }
    if (best === null) break;
    current.set(best, (current.get(best) ?? 0) - total);
    left.set(best, (left.get(best) ?? 0) - 1);
    order.push(best);
  }
  return order;
}

/** Where a calendar entry counts: its network's posts, or the shared short videos. */
function bucketNetwork(entry: Pick<CmoCalendarEntry, "channel" | "format">) {
  const channel = entry.channel.toLowerCase();
  const rate = (
    CMO_NETWORK_VOLUME.all_in as Record<string, { videos?: number }>
  )[channel];
  const video = Boolean(formatsOf(channel)[entry.format]?.video);
  if (video && rate?.videos !== undefined) return "short";
  return channel;
}

type Position = Omit<CmoMonthSlot, "id" | "pillar" | "approach" | "stage">;

/** `count` days of a week, spread evenly from its first. */
function weekDays(count: number): number[] {
  if (count >= 7)
    return Array.from({ length: count }, (_, index) => index % 7).sort(
      (a, b) => a - b,
    );
  return Array.from({ length: count }, (_, index) =>
    Math.floor((index * 7) / count),
  );
}

/**
 * The posts the month still needs, where and when: each network at its
 * rate, the short videos shared by TikTok, Reels and Shorts, a weekly
 * talking video on every network that takes one. What the calendar holds
 * already (the strategy's examples, a month written before) fills its own
 * place first.
 */
export function cmoMonthPositions(input: {
  channels: MarketingStrategyPlan["channels"];
  level: CmoVolumeLevel;
  start: string;
  existing: readonly Pick<
    CmoCalendarEntry,
    "date" | "channel" | "format" | "status"
  >[];
}): Position[] {
  const { start, level } = input;
  const targets = cmoMonthTargets(input.channels, level);
  const live = input.existing.filter((entry) => {
    const day = dayIndex(start, entry.date);
    return entry.status !== "skipped" && day >= 0 && day < CMO_MONTH_DAYS;
  });
  const held = (network: string, from: number, days: number) =>
    live.filter((entry) => {
      const day = dayIndex(start, entry.date);
      return (
        bucketNetwork(entry) === network && day >= from && day < from + days
      );
    }).length;
  const positions: Position[] = [];
  const turn = new Map<string, number>();
  const nextFormat = (network: string) => {
    const turns = FORMAT_TURNS[network] ?? ["post"];
    const index = turn.get(network) ?? 0;
    turn.set(network, index + 1);
    return turns[index % turns.length]!;
  };
  for (const target of targets.networks) {
    const { network } = target;
    const times = TIMES[network] ?? ["10:00"];
    if (target.per === "day") {
      for (let day = 0; day < CMO_MONTH_DAYS; day++) {
        const missing = target.rate - held(network, day, 1);
        for (let slot = 0; slot < missing; slot++)
          positions.push({
            date: addDays(start, day),
            time: times[slot % times.length]!,
            channel: network,
            format: nextFormat(network),
          });
      }
      continue;
    }
    for (let week = 0; week < 4; week++) {
      const missing = target.rate - held(network, week * 7, 7);
      const days = weekDays(target.rate).slice(target.rate - missing);
      const video = WEEKLY_VIDEO[network];
      days.forEach((day, index) => {
        const sameDay = days.slice(0, index).filter((d) => d === day).length;
        positions.push({
          date: addDays(start, week * 7 + day),
          time: times[sameDay % times.length]!,
          channel: network,
          format: video && index === 0 ? video : nextFormat(network),
        });
      });
    }
  }
  const shortNetworks = targets.shortNetworks;
  if (shortNetworks.length > 0 && targets.shortVideosPerWeek > 0) {
    let lead = 0;
    for (let week = 0; week < 4; week++) {
      const missing = targets.shortVideosPerWeek - held("short", week * 7, 7);
      const days = weekDays(targets.shortVideosPerWeek).slice(
        targets.shortVideosPerWeek - Math.max(0, missing),
      );
      days.forEach((day, index) => {
        const network = shortNetworks[lead % shortNetworks.length]!;
        lead += 1;
        const sameDay = days.slice(0, index).filter((d) => d === day).length;
        const others = shortNetworks.filter((other) => other !== network);
        positions.push({
          date: addDays(start, week * 7 + day),
          time: TIMES.short![sameDay % TIMES.short!.length]!,
          channel: network,
          format: cmoShortVideoFormat(network)!,
          ...(others.length > 0 ? { alsoOn: [...others] } : {}),
        });
      });
    }
  }
  return withTalkingVideos(positions, {
    channels: input.channels,
    level,
    start,
    existing: live,
  });
}

/**
 * Turns one post a week of the lead network into a talking video that goes
 * out on every other network of the strategy that takes one, until the
 * month holds its plan's talking videos.
 */
function withTalkingVideos(
  positions: Position[],
  input: {
    channels: MarketingStrategyPlan["channels"];
    level: CmoVolumeLevel;
    start: string;
    existing: readonly Pick<CmoCalendarEntry, "date" | "channel" | "format">[];
  },
): Position[] {
  const planned = input.channels.map((channel) =>
    channel.channel.toLowerCase(),
  );
  const takes = planned.filter((key) =>
    Object.keys(formatsOf(key)).includes("talking_video"),
  );
  const lead = TALKING_LEADS.find((key) => takes.includes(key));
  if (!lead) return positions;
  const talking = input.existing.filter((entry) =>
    isCmoTalkingFormat(entry.channel.toLowerCase(), entry.format),
  );
  let left = CMO_MONTH_TALKING_VIDEOS[input.level] - talking.length;
  const weeks = Array.from({ length: 4 }, (_, week) => week).filter(
    (week) =>
      !talking.some(
        (entry) => Math.floor(dayIndex(input.start, entry.date) / 7) === week,
      ),
  );
  // Fewer than four: every other week, so they still spread over the month.
  const chosen =
    left >= weeks.length
      ? weeks
      : weeks.filter((_, index) => index % 2 === 0).slice(0, left);
  const leadBucket = bucketNetwork({ channel: lead, format: "talking_video" });
  for (const week of chosen) {
    if (left <= 0) break;
    const at = positions.findIndex(
      (position) =>
        bucketNetwork(position) === leadBucket &&
        (leadBucket === "short" || position.channel === lead) &&
        Math.floor(dayIndex(input.start, position.date) / 7) === week,
    );
    if (at < 0) continue;
    const position = positions[at]!;
    positions[at] = {
      ...position,
      channel: lead,
      format: "talking_video",
      alsoOn: takes.filter((key) => key !== lead),
    };
    left -= 1;
  }
  return positions;
}

/** A Core-written entry's id: its network, day and place in the day. */
function slotId(position: Position, taken: Set<string>): string {
  const base = `m-${position.channel}-${position.date.replaceAll("-", "")}`;
  for (let n = 1; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

function counted<T extends string>(
  entries: readonly Pick<CmoCalendarEntry, "pillar" | "approach">[],
  key: (entry: Pick<CmoCalendarEntry, "pillar" | "approach">) => T | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const value = key(entry);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/**
 * The posts Core still writes for a month, each with its pillar, approach
 * and funnel step. Per network the pillars and approaches follow the
 * strategy's shares, counting what the calendar already holds, so every
 * network's month holds them and so does the whole.
 */
export function cmoPlanMonthSlots(input: {
  plan: Pick<
    MarketingStrategyPlan,
    "channels" | "pillars" | "mix" | "calendar"
  >;
  level: CmoVolumeLevel;
  start: string;
  /** Material per pillar, handed out in turn: research items, then facts. */
  seeds?: ReadonlyMap<string, readonly string[]>;
  /** Proof for social-proof posts, in turn. */
  proof?: readonly string[];
}): CmoMonthSlot[] {
  const { plan } = input;
  const live = plan.calendar.filter((entry) => entry.status !== "skipped");
  const positions = cmoMonthPositions({
    channels: plan.channels,
    level: input.level,
    start: input.start,
    existing: live,
  });
  const pillarWeights = new Map(
    plan.pillars.map((pillar) => [pillar.name, pillar.share]),
  );
  const mix = plan.mix.length
    ? plan.mix
    : [{ approach: "educational" as Approach, share: 100 }];
  const mixWeights = new Map<string, number>(
    mix.map((part) => [part.approach, part.share]),
  );
  const taken = new Set(plan.calendar.map((entry) => entry.id));
  const byNetwork = new Map<string, Position[]>();
  for (const position of positions)
    byNetwork.set(position.channel, [
      ...(byNetwork.get(position.channel) ?? []),
      position,
    ]);
  const slots: CmoMonthSlot[] = [];
  const seedTurn = new Map<string, number>();
  let proofTurn = 0;
  for (const [network, own] of byNetwork) {
    const ordered = own.toSorted(
      (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time),
    );
    const already = live.filter(
      (entry) => entry.channel.toLowerCase() === network,
    );
    const pillarOf = (entry: Pick<CmoCalendarEntry, "pillar">) =>
      plan.pillars.find(
        (pillar) =>
          entry.pillar &&
          pillar.name.trim().toLowerCase() ===
            entry.pillar.trim().toLowerCase(),
      )?.name;
    const pillars = cmoSpread(
      cmoQuota(
        pillarWeights,
        ordered.length,
        counted(already, (entry) => pillarOf(entry)),
      ),
    );
    const approaches = cmoSpread(
      cmoQuota(
        mixWeights,
        ordered.length,
        counted(already, (entry) => entry.approach),
      ),
    ) as Approach[];
    // Each approach's steps spread on their own, so the month keeps them.
    const stageTurns = new Map<Approach, Stage[]>();
    const approachCount = new Map<Approach, number>();
    for (const approach of approaches)
      approachCount.set(approach, (approachCount.get(approach) ?? 0) + 1);
    for (const [approach, count] of approachCount)
      stageTurns.set(
        approach,
        cmoSpread(
          cmoQuota(
            new Map(
              Object.entries(STAGE_WEIGHTS[approach] ?? { awareness: 1 }),
            ),
            count,
          ),
        ) as Stage[],
      );
    ordered.forEach((position, index) => {
      const approach = approaches[index] ?? mix[0]!.approach;
      const stage = stageTurns.get(approach)?.shift() ?? "awareness";
      const pillar = pillars[index] ?? plan.pillars[0]?.name ?? "";
      const pillarSeeds = input.seeds?.get(pillar) ?? [];
      let seed: string | undefined;
      if (approach === "social-proof" && input.proof?.length) {
        seed = input.proof[proofTurn % input.proof.length];
        proofTurn += 1;
      } else if (pillarSeeds.length > 0) {
        const turn = seedTurn.get(pillar) ?? 0;
        seed = pillarSeeds[turn % pillarSeeds.length];
        seedTurn.set(pillar, turn + 1);
      }
      slots.push({
        ...position,
        id: slotId(position, taken),
        pillar,
        approach,
        stage,
        ...(seed ? { seed } : {}),
      });
    });
  }
  return withEveryStage(slots);
}

/**
 * A month whose mix has no promotional or social-proof approach would ask
 * nobody to buy: a few posts per network move to the steps nobody serves,
 * the last of each network's posts, so every step has posts.
 */
function withEveryStage(slots: CmoMonthSlot[]): CmoMonthSlot[] {
  const stages: Stage[] = ["awareness", "interest", "desire", "action"];
  const missing = stages.filter(
    (stage) => !slots.some((slot) => slot.stage === stage),
  );
  if (missing.length === 0 || slots.length < stages.length) return slots;
  const networks = [...new Set(slots.map((slot) => slot.channel))];
  for (const network of networks) {
    const own = slots.filter((slot) => slot.channel === network);
    const each = Math.max(1, Math.floor(own.length / 10));
    let at = own.length - 1;
    for (const stage of missing)
      for (let n = 0; n < each && at >= 0; n++, at--) own[at]!.stage = stage;
  }
  return slots;
}

/**
 * The month's slots in chunks one model call writes: one network's week,
 * at most `size` posts, so a chunk keeps one voice and one season and the
 * chunks run side by side.
 */
export function cmoMonthChunks(
  slots: readonly CmoMonthSlot[],
  start: string,
  size: number,
): CmoMonthSlot[][] {
  const groups = new Map<string, CmoMonthSlot[]>();
  for (const slot of slots) {
    const week = Math.floor(dayIndex(start, slot.date) / 7);
    const key = `${slot.channel}:${week}`;
    groups.set(key, [...(groups.get(key) ?? []), slot]);
  }
  return [...groups.values()].flatMap((group) => {
    const parts = Math.ceil(group.length / size);
    const per = Math.ceil(group.length / parts);
    return Array.from({ length: parts }, (_, part) =>
      group.slice(part * per, (part + 1) * per),
    );
  });
}

/** The networks a short video's entry reaches, for counting. */
export function cmoSlotNetworks(
  slot: Pick<CmoMonthSlot, "channel" | "format" | "alsoOn">,
): string[] {
  return isCmoShortVideoFormat(slot.channel, slot.format) ||
    isCmoTalkingFormat(slot.channel, slot.format)
    ? [slot.channel, ...(slot.alsoOn ?? [])]
    : [slot.channel];
}

export type { CmoVolumeNetwork };
