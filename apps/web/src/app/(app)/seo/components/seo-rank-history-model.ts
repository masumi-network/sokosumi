import type { ProjectSeoWorkspace } from "@sokosumi/core-client";

type Keyword = ProjectSeoWorkspace["keywords"][number];

export type SeoRankSeries = {
  device: Keyword["device"];
  /**
   * One point per day with a read, oldest first: the newest read of the day. Null with `outside`: the page was
   * not in the results the read checked (`top` of them; null when the check did not say how many).
   */
  points: {
    date: string;
    value: number | null;
    outside?: { top: number | null };
  }[];
};
type RankPoint = SeoRankSeries["points"][number];

const dayOf = (at: Date | string) => new Date(at).toISOString().slice(0, 10);
const DEVICE_ORDER: Record<string, number> = { mobile: 0, desktop: 1 };

/**
 * The paid position reads of a keyword's rows, one series per device: rows of one device (a read and the same
 * keyword listed for another reason) share it. A failed read ("unavailable") is no point. A series of one read
 * repeats the position cell, so only a keyword with two days of reads has a history.
 */
export function seoRankHistory(rows: Keyword[]): SeoRankSeries[] {
  const byDevice = new Map<
    Keyword["device"],
    Map<string, Omit<RankPoint, "date">>
  >();
  const points = rows
    .flatMap((row) => row.positionHistory ?? [])
    .filter((point) => point.positionStatus !== "unavailable")
    .toSorted(
      (a, b) =>
        new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
    );
  for (const point of points) {
    const days =
      byDevice.get(point.device) ?? new Map<string, Omit<RankPoint, "date">>();
    days.set(
      dayOf(point.observedAt),
      point.positionStatus === "ranked"
        ? { value: point.position }
        : { value: null, outside: { top: point.checkedResults ?? null } },
    );
    byDevice.set(point.device, days);
  }
  const series = [...byDevice]
    .map(([device, days]) => ({
      device,
      points: [...days]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, read]) => ({ date, ...read })),
    }))
    .toSorted(
      (a, b) =>
        (DEVICE_ORDER[a.device ?? ""] ?? 2) -
        (DEVICE_ORDER[b.device ?? ""] ?? 2),
    );
  return series.some((item) => item.points.length > 1) ? series : [];
}
