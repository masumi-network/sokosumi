import type { CmoOverview } from "@sokosumi/core-client";
import { channelInfo } from "./channels";

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
