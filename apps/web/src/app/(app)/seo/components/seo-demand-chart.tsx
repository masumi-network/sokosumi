"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { seoMarketName } from "./seo-shared";
import { seoDemandAxis, type seoKeywordDemand } from "./seo-summary-model";

/** A bar keeps this share of the scale, so a small count still shows. */
const BAR_MIN_PERCENT = 1;
/** Label and plot share one row from this width up; under it the label stands over its bar. */
const ROW_CLASS =
  "sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-center sm:gap-x-4";
/** The plot keeps room on the right for the number after the longest bar. */
const PLOT_CLASS = "relative mr-14";

/**
 * Horizontal bars: the checked keywords by their monthly searches, on one
 * scale with a round axis. Every bar has its number, so no legend and no
 * hover is needed to read it; the row's title repeats it in one sentence.
 */
export function SeoDemandChart({
  demand,
}: {
  demand: ReturnType<typeof seoKeywordDemand>;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const locale = useLocale();
  const axis = seoDemandAxis(demand.max);
  const percent = (value: number) => (value / axis.top) * 100;
  // The scale lines of one row. Rows touch, so the lines read as one grid.
  const lines = (
    <span aria-hidden>
      {axis.ticks.map((tick) => (
        <span
          key={tick}
          className={cn(
            "absolute inset-y-0 border-l",
            tick ? "border-border" : "border-tertiary",
          )}
          style={{ left: `${percent(tick)}%` }}
        />
      ))}
    </span>
  );
  return (
    <figure
      className="space-y-3 rounded-md border p-3"
      data-testid="seo-demand-chart"
    >
      <figcaption className="space-y-0.5">
        <span className="block text-sm font-medium">
          {t("agent.demand.title")}
        </span>
        <span className="text-muted-foreground block text-xs">
          {t("agent.demand.unit")}
        </span>
      </figcaption>
      <div>
        <ol role="list">
          {demand.rows.map((row) => {
            const volume = format.number(row.volume);
            const position =
              row.best === null
                ? null
                : t("agent.demand.position", { position: row.best });
            return (
              <li
                key={JSON.stringify([
                  row.keyword,
                  row.countryCode,
                  row.languageCode,
                ])}
                className={cn(ROW_CLASS, "group text-sm")}
                title={[
                  `${row.keyword}: ${volume} ${t("keywords.volumeUnit", { count: row.volume })}`,
                  position,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                <p className="flex items-baseline justify-between gap-x-2 max-sm:pt-1.5">
                  <span className="min-w-0 truncate">
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
                  {/* The position shows only where the check found the page: the tile above counts the rest. */}
                  {position ? (
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {position}
                    </span>
                  ) : null}
                </p>
                <div className={cn(PLOT_CLASS, "h-7")}>
                  {lines}
                  <span
                    aria-hidden
                    data-testid="seo-demand-bar"
                    className="bg-chart-5 absolute inset-y-2 left-0 rounded-r-sm opacity-90 transition-opacity duration-150 ease-out group-hover:opacity-100 motion-reduce:transition-none"
                    style={{
                      width: `${Math.max(BAR_MIN_PERCENT, percent(row.volume))}%`,
                    }}
                  />
                  <span
                    className="absolute top-1/2 -translate-y-1/2 pl-1.5 text-xs whitespace-nowrap tabular-nums"
                    style={{
                      left: `${Math.max(BAR_MIN_PERCENT, percent(row.volume))}%`,
                    }}
                  >
                    {volume}
                    <span className="sr-only">
                      {" "}
                      {t("keywords.volumeUnit", { count: row.volume })}
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
        {/* The axis: the same columns as a row, so each number stands under its line. */}
        <div aria-hidden className={ROW_CLASS}>
          <span />
          <div
            className={cn(
              PLOT_CLASS,
              "text-muted-foreground h-5 text-xs tabular-nums",
            )}
          >
            {axis.ticks.map((tick) => (
              <span
                key={tick}
                className={cn(
                  "absolute top-1",
                  // The first number starts at its line: centered, it would leave the plot.
                  tick ? "-translate-x-1/2" : null,
                )}
                style={{ left: `${percent(tick)}%` }}
              >
                {format.number(tick, { notation: "compact" })}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
