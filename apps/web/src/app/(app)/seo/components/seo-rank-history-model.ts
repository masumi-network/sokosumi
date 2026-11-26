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
  /** Older reads of the period exist that the workspace did not send (its load or point limit). */
  cut: boolean;
};
type RankPoint = SeoRankSeries["points"][number];

/**
 * Gives the calendar day of a read in a time zone, as YYYY-MM-DD. One formatter serves every read of a call.
 * A time zone the runtime does not know (stored data can hold one) reads as UTC: the table must still render.
 */
function dayIn(timeZone: string) {
  const formatter = (zone: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  let format: Intl.DateTimeFormat;
  try {
    format = formatter(timeZone);
  } catch {
    format = formatter("UTC");
  }
  return (at: Date | string) => {
    const part = Object.fromEntries(
      format
        .formatToParts(new Date(at))
        .map(({ type, value }) => [type, value]),
    );
    return `${part.year}-${part.month}-${part.day}`;
  };
}
const DEVICE_ORDER: Record<string, number> = { mobile: 0, desktop: 1 };

/**
 * The paid position reads of a keyword's rows, one series per device: rows of one device (a read and the same
 * keyword listed for another reason) share it. A failed read ("unavailable") is no point. A series of one read
 * repeats the position cell, so only a keyword with two days of reads has a history.
 */
export function seoRankHistory(
  rows: Keyword[],
  /**
   * The time zone of the Search Console days the chart beside it shows, so a read sits on the same day in both.
   * Default: UTC.
   */
  timeZone = "UTC",
): SeoRankSeries[] {
  const dayOf = dayIn(timeZone);
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
      cut: rows.some(
        (row) => row.device === device && row.positionHistoryCut === true,
      ),
      points: [...days]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, read]) => ({ date, ...read })),
    }))
    .toSorted(
      (a, b) =>
        (DEVICE_ORDER[a.device ?? ""] ?? 2) -
        (DEVICE_ORDER[b.device ?? ""] ?? 2),
    );
  // One day is no history, unless older checks exist and are not shown: the reader must see that note.
  return series.some((item) => item.points.length > 1 || item.cut)
    ? series
    : [];
}
