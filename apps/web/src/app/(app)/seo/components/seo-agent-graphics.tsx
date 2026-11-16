"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SeoDemandChart } from "./seo-demand-chart";
import { latestSeoMeasurements, seoChartMarkers } from "./seo-statistics-model";
import { seoKeywordDemand } from "./seo-summary-model";
import { SeoTrendChart } from "./seo-trend-chart";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** How many keywords the demand picture names. */
const DEMAND_ROWS = 5;

type SeoAgentChart = "clicks" | "keywords";

// Each choice starts as wide as its own name: equal shares squeezed the longer name to the edge of its pill. On
// a narrow screen both still shrink, so the switch stays inside the card.
const CHART_SWITCH_ITEM_CLASS = "flex-auto px-4";

/**
 * The Agent tab's pictures, each from saved data only: the daily search clicks
 * once statistics are synced, and the checked keywords with the most searches.
 * One card holds both, with a switch when both have data.
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
  const hasClicks = Boolean(
    clicks?.points.some((point) => (point.value ?? 0) > 0),
  );
  // Both pictures share one card. It opens on the one with something to show: the daily clicks once the
  // site gets clicks, otherwise the searches for the checked keywords.
  const [picked, setPicked] = useState<SeoAgentChart | null>(null);
  const both = Boolean(clicks && demand.rows.length);
  // With one picture left the choice ends, so the default applies when both come back.
  if (!both && picked) setPicked(null);
  // A choice holds only while the switch shows: with one picture left, that picture shows.
  const shown: SeoAgentChart =
    (both ? picked : null) ??
    (clicks && (hasClicks || !demand.rows.length) ? "clicks" : "keywords");
  if (!clicks && !demand.rows.length) return null;
  return (
    <div
      className="bg-background min-w-0 space-y-3 rounded-lg border p-3"
      data-testid="seo-agent-graphics"
    >
      {both ? (
        <ToggleGroup
          type="single"
          aria-label={t("agent.chart")}
          value={shown}
          onValueChange={(value) => {
            // Pressing the chosen picture again would clear the choice; keep it.
            if (value === "clicks" || value === "keywords") setPicked(value);
          }}
        >
          <ToggleGroupItem value="clicks" className={CHART_SWITCH_ITEM_CLASS}>
            {t("metrics.clicks")}
          </ToggleGroupItem>
          <ToggleGroupItem value="keywords" className={CHART_SWITCH_ITEM_CLASS}>
            {t("agent.chartKeywords")}
          </ToggleGroupItem>
        </ToggleGroup>
      ) : clicks ? (
        // Alone, the clicks picture needs a title; the switch names it otherwise. The chart group carries it too.
        <p aria-hidden className="text-sm font-medium">
          {t("metrics.clicks")}
        </p>
      ) : null}
      {clicks && shown === "clicks" ? (
        <SeoTrendChart
          key={clicks.id}
          series={clicks}
          label={t("metrics.clicks")}
          points={clicks.points}
          unit={clicks.unit}
          unavailable={t("none")}
          formatValue={(value) => format.number(value)}
          markers={seoChartMarkers(model.data, clicks.timeZone)}
        />
      ) : (
        <SeoDemandChart demand={demand} />
      )}
    </div>
  );
}
