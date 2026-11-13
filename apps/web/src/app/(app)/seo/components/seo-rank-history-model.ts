import type { ProjectSeoWorkspace } from "@sokosumi/core-client";

type Keyword = ProjectSeoWorkspace["keywords"][number];

export type SeoRankSeries = {
  device: Keyword["device"];
  /** One point per day with a read, oldest first: the newest read of the day. Null: the page was not in the checked results. */
  points: { date: string; value: number | null }[];
};

const dayOf = (at: Date | string) => new Date(at).toISOString().slice(0, 10);

/**
 * The paid position reads of a keyword's rows, one series per device. A failed read ("unavailable") is no
 * point. A series of one read repeats the position cell, so only a keyword with two days of reads has a history.
 */
export function seoRankHistory(reads: Keyword[]): SeoRankSeries[] {
  const series = reads.map((row) => {
    const byDay = new Map<string, number | null>();
    for (const point of row.positionHistory ?? [])
      if (point.positionStatus !== "unavailable")
        byDay.set(
          dayOf(point.observedAt),
          point.positionStatus === "ranked" ? point.position : null,
        );
    return {
      device: row.device,
      points: [...byDay]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, value]) => ({ date, value })),
    };
  });
  return series.some((item) => item.points.length > 1) ? series : [];
}
