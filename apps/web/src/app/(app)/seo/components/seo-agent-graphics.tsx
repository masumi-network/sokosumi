"use client";

import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SeoDemandChart } from "./seo-demand-chart";
import {
  latestSeoMeasurements,
  seoChangeMarkers,
} from "./seo-statistics-model";
import { seoKeywordDemand } from "./seo-summary-model";
import { SeoTrendChart } from "./seo-trend-chart";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** How many keywords the demand picture names. */
const DEMAND_ROWS = 5;

/**
 * The Agent tab's pictures, each from saved data only: the daily search clicks
 * once statistics are synced, and the checked keywords with the most searches.
 */
export function SeoAgentGraphics({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const clicks = latestSeoMeasurements(model.data.metrics).find(
    (metric) =>
      metric.source === "search_console" &&
      metric.key === "clicks" &&
      metric.coverage !== "unavailable" &&
      // One measured day is no trend.
      metric.points.filter((point) => point.value !== null).length > 1,
  );
  const demand = seoKeywordDemand(model.data, DEMAND_ROWS);
  if (!clicks && !demand.rows.length) return null;
  return (
    // Beside the tiles the pictures are cells of the tiles' grid: the keyword picture stands beside the keyword
    // tiles and is as tall as they are, and the daily clicks take the full width under both. On a phone the
    // clicks come first, as before. Two pictures in one
    // column were more than twice as tall as the tiles.
    <div
      className="flex flex-col gap-2 lg:[&:not(:only-child)]:contents"
      data-testid="seo-agent-graphics"
    >
      {clicks ? (
        // The chart is a figure with its own name.
        <div
          className={cn(
            "bg-background rounded-lg border p-3",
            demand.rows.length > 0 && "lg:order-last lg:col-span-2",
          )}
        >
          <SeoTrendChart
            key={clicks.id}
            series={clicks}
            label={t("metrics.clicks")}
            points={clicks.points}
            unit={clicks.unit}
            unavailable={t("none")}
            formatValue={(value) => format.number(value)}
            markers={seoChangeMarkers(model.data.timeline, clicks.timeZone)}
          />
        </div>
      ) : null}
      {demand.rows.length ? <SeoDemandChart demand={demand} /> : null}
    </div>
  );
}
