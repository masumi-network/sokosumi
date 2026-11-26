import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import {
  SEO_VITAL_LIMITS,
  SEO_VITALS,
  type SeoSpeedHistory,
  seoHistoryGap,
  seoSpeedValue,
  seoVitalTrend,
} from "./seo-speed-model";

// The SVG's own units; the chart stretches to the width of its column.
const WIDTH = 240;
const HEIGHT = 48;
const PAD = 3;
/** The diameter of the dot of a week with no neighbor, in screen pixels. */
const DOT_WIDTH = 4;
const x = (share: number) => PAD + share * (WIDTH - 2 * PAD);
const y = (share: number) => PAD + share * (HEIGHT - 2 * PAD);

/**
 * The weekly values of each Core Web Vital for real visitors. The drawing is hidden from a screen reader: the
 * caption gives the direction, and a hidden list gives each week, with its value or "no data", so a week over the
 * limit or a gap is not lost. The list comes before the caption: a figcaption is the first or last child.
 */
export function SeoSpeedTrend({ history }: { history: SeoSpeedHistory }) {
  const t = useSeoResultTranslations("App.Seo");
  const format = useSeoResultFormatter();
  const gap = seoHistoryGap(history);
  // The title names the weeks that the gap text speaks of.
  if (gap)
    return (
      <div className="space-y-2">
        <h5 className="font-medium">{t("siteSpeed.trendTitle")}</h5>
        <p className="text-muted-foreground max-w-prose text-xs">
          {t(`siteSpeed.noTrend.${gap}`)}
        </p>
      </div>
    );
  const day = (week: string) =>
    format.dateTime(new Date(`${week}T12:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
  return (
    <div className="space-y-2">
      <h5 className="font-medium">{t("siteSpeed.trendTitle")}</h5>
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-3">
        {SEO_VITALS.map((metric) => {
          const trend = seoVitalTrend(metric, history);
          const name = t(`pageSpeed.metricsTitle.${metric}`);
          if (!trend.chart)
            return (
              <p key={metric} className="text-muted-foreground text-xs">
                {name}: {t(`siteSpeed.noTrend.${trend.reason}`)}
              </p>
            );
          // A week without a value ends a line; the next week with one starts a new line.
          const path = trend.points
            .map((point, index) =>
              point.y == null
                ? ""
                : `${trend.points[index - 1]?.y == null ? "M" : "L"}${x(point.x).toFixed(1)} ${y(point.y).toFixed(1)}`,
            )
            .join("");
          // A line of no length with a round end is a dot.
          const dots = trend.points
            .map((point) =>
              point.alone && point.y != null
                ? `M${x(point.x).toFixed(1)} ${y(point.y).toFixed(1)}h0`
                : "",
            )
            .join("");
          const limit = y(trend.limit).toFixed(1);
          return (
            <figure key={metric} className="min-w-0">
              <svg
                aria-hidden
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                preserveAspectRatio="none"
                className="h-12 w-full"
              >
                <line
                  x1={0}
                  x2={WIDTH}
                  y1={limit}
                  y2={limit}
                  className="stroke-border"
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={path}
                  fill="none"
                  className="stroke-foreground"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                {dots && (
                  <path
                    d={dots}
                    fill="none"
                    className="stroke-foreground"
                    strokeWidth={DOT_WIDTH}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>
              <ul className="sr-only">
                {trend.series.map((point) => (
                  <li key={point.week}>
                    {point.value == null
                      ? t("siteSpeed.trendWeekNone", { date: day(point.week) })
                      : t("siteSpeed.trendWeek", {
                          date: day(point.week),
                          value: seoSpeedValue(metric, point.value),
                        })}
                  </li>
                ))}
              </ul>
              <figcaption className="text-muted-foreground mt-1 text-xs tabular-nums">
                <span className="text-foreground font-medium">
                  {t(`siteSpeed.trend.${trend.direction}`)}
                </span>{" "}
                {t("siteSpeed.trendText", {
                  metric: name,
                  first: seoSpeedValue(metric, trend.first.value),
                  firstDate: day(trend.first.week),
                  last: seoSpeedValue(metric, trend.last.value),
                  lastDate: day(trend.last.week),
                })}{" "}
                {t("siteSpeed.trendLimit", {
                  good: seoSpeedValue(metric, SEO_VITAL_LIMITS[metric].good),
                })}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
