import type {
  ProjectSeoMetric,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import {
  SEO_STATISTICS_SEARCH_CONSOLE_FINAL_DATA_NOTE,
  seoStatisticsLostData,
} from "@sokosumi/utils";
import {
  SEO_MIN_COMPARE_IMPRESSIONS,
  seoWeekOverWeek,
} from "./seo-performance-model";

const MIN_LOST_CLICKS = 5;
const MIN_RELATIVE_LOSS = 0.2;
const STABLE_POSITION = 0.5;
const METRICS = ["clicks", "impressions", "position"] as const;

/** The Metrics tab has already selected a source. Keep one original native receipt, including its property and scope. */
export function seoSearchPeriodInsight(
  sharing: ProjectSeoWorkspace["sharing"],
  metrics: ProjectSeoMetric[],
  scope: Pick<ProjectSeoWorkspace["scope"], "from" | "to">,
) {
  if (sharing !== "personal") return null;
  const selected = METRICS.map((key) => metrics.filter((m) => m.key === key));
  if (selected.some((rows) => rows.length !== 1)) return null;
  const rows = selected.map(([row]) => row);
  const [first] = rows;
  const receipt = first.id.slice(0, -":clicks".length);
  if (
    !receipt ||
    rows.some(
      (m) =>
        m.source !== "search_console" ||
        (m.searchType ?? "web") !== "web" ||
        m.timeZone !== "America/Los_Angeles" ||
        // Native GSC labels even a successful final read partial because its daily series can omit quiet days.
        // Evaluate the two measured weeks below. A failed or unavailable source cannot support this card.
        m.coverage === "unavailable" ||
        m.value === null ||
        seoStatisticsLostData(m.notes) ||
        (m.coverage === "partial" &&
          !m.notes.includes(SEO_STATISTICS_SEARCH_CONSOLE_FINAL_DATA_NOTE)) ||
        m.id !== receipt + ":" + m.key ||
        m.from !== first.from ||
        m.to !== first.to ||
        m.propertyId !== first.propertyId ||
        m.channel !== first.channel ||
        new Date(m.observedAt).getTime() !==
          new Date(first.observedAt).getTime(),
    )
  )
    return null;
  // The weekly helper weights positions by impressions. Require a measured position for every contributing day.
  const daily = rows.map(
    (m) => new Map(m.points.map((p) => [p.date, p.value])),
  );
  if (
    rows.some(
      (m, i) =>
        m.points.length !== daily[i].size ||
        m.points.some((p) => p.date < m.from || p.date > m.to),
    )
  )
    return null;
  const comparison = seoWeekOverWeek(rows);
  if (
    !comparison ||
    (scope.from && comparison.current.from < scope.from) ||
    (scope.to && comparison.current.to > scope.to)
  )
    return null;
  for (const [day, impressions] of daily[1]) {
    if (day < comparison.previous.from || day > comparison.current.to) continue;
    const clicks = daily[0].get(day),
      position = daily[2].get(day);
    if (
      impressions == null ||
      !Number.isSafeInteger(impressions) ||
      clicks == null ||
      !Number.isSafeInteger(clicks) ||
      clicks < 0 ||
      clicks > impressions ||
      (impressions > 0 &&
        (position == null || !Number.isFinite(position) || position < 1))
    )
      return null;
  }
  const { clicks, impressions, position } = comparison.values;
  if (
    clicks?.current == null ||
    clicks.previous == null ||
    impressions?.current == null ||
    impressions.previous == null ||
    position?.current == null ||
    position.previous == null ||
    impressions.previous < SEO_MIN_COMPARE_IMPRESSIONS ||
    impressions.current < impressions.previous ||
    clicks.previous - clicks.current <
      Math.max(MIN_LOST_CLICKS, clicks.previous * MIN_RELATIVE_LOSS) ||
    Math.abs(position.current - position.previous) > STABLE_POSITION
  )
    return null;
  return {
    previous: comparison.previous,
    current: comparison.current,
    property: first.propertyId,
    beforeClicks: clicks.previous,
    afterClicks: clicks.current,
    beforeImpressions: impressions.previous,
    afterImpressions: impressions.current,
    beforePosition: position.previous,
    afterPosition: position.current,
  };
}
