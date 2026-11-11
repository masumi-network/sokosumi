"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { seoMarketName } from "./seo-shared";
import {
  latestSeoMeasurements,
  seoChangeMarkers,
} from "./seo-statistics-model";
import { seoKeywordDemand } from "./seo-summary-model";
import { SeoTrendChart } from "./seo-trend-chart";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** How many keywords the demand picture names. */
const DEMAND_ROWS = 5;
/** A bar keeps this share of the track, so a small count still shows. */
const DEMAND_BAR_MIN_PERCENT = 2;

/**
 * The Agent tab's pictures, each from saved data only: the daily search clicks
 * once statistics are synced, and the checked keywords with the most searches.
 */
export function SeoAgentGraphics({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const locale = useLocale();
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
    <div className="space-y-2" data-testid="seo-agent-graphics">
      {clicks ? (
        // The chart is a figure with its own name.
        <div className="rounded-md border p-3">
          <SeoTrendChart
            key={clicks.id}
            label={t("metrics.clicks")}
            points={clicks.points}
            unit={clicks.unit}
            unavailable={t("none")}
            formatValue={(value) => format.number(value)}
            markers={seoChangeMarkers(model.data.timeline, clicks.timeZone)}
          />
        </div>
      ) : null}
      {demand.rows.length ? (
        <figure className="space-y-2.5 rounded-md border p-3">
          <figcaption className="text-muted-foreground text-xs">
            {t("agent.demand.title")}
          </figcaption>
          <ol role="list" className="space-y-2">
            {demand.rows.map((row) => (
              <li
                key={JSON.stringify([
                  row.keyword,
                  row.countryCode,
                  row.languageCode,
                ])}
                className="space-y-1 text-sm"
              >
                {/* On a phone the numbers go under the keyword: beside them it had room for a few letters. */}
                <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 grow basis-full truncate sm:basis-0">
                    <bdi>{row.keyword}</bdi>
                    {demand.manyMarkets ? (
                      <span className="text-muted-foreground text-xs">
                        {" "}
                        {seoMarketName(
                          locale,
                          row.countryCode,
                          row.languageCode,
                        )}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {/* The position shows only where the check found the page: the tile above counts the rest. */}
                    {row.best === null
                      ? null
                      : `${t("agent.demand.position", { position: row.best })} · `}
                    {format.number(row.volume)}{" "}
                    {t("keywords.volumeUnit", { count: row.volume })}
                  </span>
                </p>
                <span
                  aria-hidden
                  className="bg-muted-foreground/15 block h-1.5 rounded-full"
                >
                  <span
                    className="bg-chart-5 block h-full rounded-full"
                    style={{
                      width: `${Math.max(DEMAND_BAR_MIN_PERCENT, Math.round((row.volume / demand.max) * 100))}%`,
                    }}
                  />
                </span>
              </li>
            ))}
          </ol>
        </figure>
      ) : null}
    </div>
  );
}
