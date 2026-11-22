import type { CmoOverview } from "@sokosumi/core-client";
import { channelInfo, channelKey } from "./channels";

/** Whether the newest strategy version is approved, so Cuso carries it out. */
export function strategyApproved(
  overview: Pick<CmoOverview, "strategyVersion">,
): boolean {
  return overview.strategyVersion?.approvedAt != null;
}

type CalendarEntry = NonNullable<CmoOverview["strategy"]>["calendar"][number];

/** A search or social ad: the owner launches it, it is never a post. */
export function isAd(entry: Pick<CalendarEntry, "channel">): boolean {
  return channelInfo(entry.channel)?.group === "ads";
}

/**
 * Posts in the month, counted the same on every page: each piece not
 * skipped, and each other network a talking video also goes out on. Before
 * approval those networks are `alsoOn`; after it each is its own entry
 * (`videoOf`), so it is never counted twice.
 */
export function monthPostCount(calendar: readonly CalendarEntry[]): number {
  const live = calendar.filter(
    (entry) => entry.status !== "skipped" && !isAd(entry),
  );
  const split = new Set(live.flatMap((entry) => entry.videoOf ?? []));
  return (
    live.length +
    live
      .filter((entry) => !entry.videoOf && !split.has(entry.id))
      .reduce((sum, entry) => sum + (entry.alsoOn?.length ?? 0), 0)
  );
}

/**
 * The month's posts as the Strategy page counts them: "171 posts", or "171
 * planned, 169 in your plan" when the plan bought makes fewer (Core's
 * beyondPlan), so the number matches what goes out on Today and the Calendar.
 */
export function planCount(
  calendar: readonly CalendarEntry[],
  beyondPlan: readonly string[],
): { label: string; planned: number; inPlan: number } {
  const beyond = new Set(beyondPlan);
  const planned = monthPostCount(calendar);
  const inPlan = monthPostCount(
    calendar.filter((entry) => !beyond.has(entry.id)),
  );
  return {
    label:
      inPlan < planned
        ? `${planned} planned, ${inPlan} in your plan`
        : monthLabel(calendar),
    planned,
    inPlan,
  };
}

/** The ads in the month, not skipped. */
export function monthAdCount(calendar: readonly CalendarEntry[]): number {
  return calendar.filter((entry) => entry.status !== "skipped" && isAd(entry))
    .length;
}

/** "171 posts", or "171 posts and 2 ads" when the month has ads. */
export function monthLabel(calendar: readonly CalendarEntry[]): string {
  const posts = monthPostCount(calendar);
  const ads = monthAdCount(calendar);
  const label = `${posts} ${posts === 1 ? "post" : "posts"}`;
  return ads > 0 ? `${label} and ${ads} ${ads === 1 ? "ad" : "ads"}` : label;
}

/**
 * Whether the owner has a plan yet (a CMO plan, or Tester credits). Until
 * then a strategy's month is the most the biggest plan makes, never a promise.
 */
export function planChosen(overview: Pick<CmoOverview, "billing">): boolean {
  return overview.billing.tier !== null || overview.billing.hasTesterCredits;
}

/**
 * The posts a plan makes on each network, busiest first: X 84, LinkedIn 28.
 * `made` is the plan's share from `cmoMonthAtLevel`; a talking video not yet
 * split into its copies counts on each network it goes out on. Ads and
 * newsletter issues are made on every plan, so they stay out.
 */
export function madeByNetwork(
  calendar: readonly CalendarEntry[],
  made: ReadonlySet<string>,
): { key: string; posts: number }[] {
  const counts = new Map<string, number>();
  for (const entry of calendar) {
    if (!made.has(entry.id)) continue;
    const split = calendar.some((copy) => copy.videoOf === entry.id);
    for (const network of [
      entry.channel,
      ...(split ? [] : (entry.alsoOn ?? [])),
    ]) {
      const key = channelKey(network) ?? network;
      if (channelInfo(key)?.owner !== "connect") continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([key, posts]) => ({ key, posts }))
    .sort((a, b) => b.posts - a.posts);
}
