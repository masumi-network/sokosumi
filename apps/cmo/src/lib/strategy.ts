import type { CmoOverview } from "@sokosumi/core-client";

/** Whether the newest strategy version is approved, so Cuso carries it out. */
export function strategyApproved(
  overview: Pick<CmoOverview, "strategyVersion">,
): boolean {
  return overview.strategyVersion?.approvedAt != null;
}

type CalendarEntry = NonNullable<CmoOverview["strategy"]>["calendar"][number];

/**
 * Posts in the month, counted the same on every page: each piece not
 * skipped, and each other network a talking video also goes out on. Before
 * approval those networks are `alsoOn`; after it each is its own entry
 * (`videoOf`), so it is never counted twice.
 */
export function monthPostCount(calendar: readonly CalendarEntry[]): number {
  const live = calendar.filter((entry) => entry.status !== "skipped");
  const split = new Set(live.flatMap((entry) => entry.videoOf ?? []));
  return (
    live.length +
    live
      .filter((entry) => !entry.videoOf && !split.has(entry.id))
      .reduce((sum, entry) => sum + (entry.alsoOn?.length ?? 0), 0)
  );
}
