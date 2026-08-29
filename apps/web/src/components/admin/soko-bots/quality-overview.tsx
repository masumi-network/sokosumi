import { getFormatter, getTranslations } from "next-intl/server";

import type { AdminSokoBotQuality } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { QualityVersionFilter } from "./quality-version-filter.client";

const WIDTH = 640;
const HEIGHT = 184;
const PLOT_TOP = 12;
const PLOT_BOTTOM = 152;
const PLOT_LEFT = 28;
const PLOT_RIGHT = 608;

function scoreTone(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 4) return "text-semantic-success";
  if (score >= 3) return "text-semantic-warning";
  return "text-semantic-destructive";
}

interface ScoreChartLabels {
  chart: string;
  countAxis: string;
  scoreLegend: string;
  thumbsDownLegend: string;
  thumbsUpLegend: string;
  scorePoint: (date: string, score: number, turns: number) => string;
  thumbsDownPoint: (date: string, count: number) => string;
  thumbsUpPoint: (date: string, count: number) => string;
}

interface ScoreChartProps {
  daily: AdminSokoBotQuality["daily"];
  formatDate: (date: string) => string;
  labels: ScoreChartLabels;
}

function dateTickIndexes(length: number): number[] {
  if (length <= 6) return Array.from({ length }, (_, index) => index);
  return Array.from({ length: 6 }, (_, index) =>
    Math.round((index * (length - 1)) / 5),
  );
}

/** Judge score and owner feedback per day, with independent score and count axes. */
function ScoreChart({ daily, formatDate, labels }: ScoreChartProps) {
  const step = (PLOT_RIGHT - PLOT_LEFT) / Math.max(1, daily.length - 1);
  function x(index: number): number {
    return PLOT_LEFT + index * step;
  }
  function scoreY(score: number): number {
    return PLOT_BOTTOM - ((score - 1) / 4) * (PLOT_BOTTOM - PLOT_TOP);
  }
  const maxThumbs = Math.max(
    1,
    ...daily.flatMap((day) => [day.thumbsUp, day.thumbsDown]),
  );
  function thumbsY(count: number): number {
    return PLOT_BOTTOM - (count / maxThumbs) * (PLOT_BOTTOM - PLOT_TOP);
  }
  const segments: string[] = [];
  let current: string[] = [];
  daily.forEach((day, index) => {
    if (day.avgScore === null) {
      if (current.length) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${x(index)},${scoreY(day.avgScore)}`);
  });
  if (current.length) segments.push(current.join(" "));
  const thumbsUpPoints = daily
    .map((day, index) => `${x(index)},${thumbsY(day.thumbsUp)}`)
    .join(" ");
  const thumbsDownPoints = daily
    .map((day, index) => `${x(index)},${thumbsY(day.thumbsDown)}`)
    .join(" ");
  const countTicks = Array.from(
    new Set([0, Math.ceil(maxThumbs / 2), maxThumbs]),
  );
  const dateTicks = dateTickIndexes(daily.length);

  return (
    <div className="space-y-2">
      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="bg-primary h-px w-4" />
          {labels.scoreLegend}
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="bg-semantic-success h-px w-4" />
          {labels.thumbsUpLegend}
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="bg-semantic-destructive h-px w-4" />
          {labels.thumbsDownLegend}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-44 w-full"
        role="img"
        aria-label={labels.chart}
      >
        {[1, 2, 3, 4, 5].map((score) => (
          <g key={score}>
            <line
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={scoreY(score)}
              y2={scoreY(score)}
              className="stroke-border"
              strokeWidth={0.5}
            />
            <text
              x={2}
              y={scoreY(score) + 3}
              className="fill-muted-foreground text-[0.5625rem]"
            >
              {score}
            </text>
          </g>
        ))}
        <text
          x={WIDTH - 2}
          y={9}
          textAnchor="end"
          className="fill-muted-foreground text-[0.5625rem]"
        >
          {labels.countAxis}
        </text>
        {countTicks.map((count) => (
          <text
            key={count}
            x={WIDTH - 2}
            y={thumbsY(count) + 3}
            textAnchor="end"
            className="fill-muted-foreground text-[0.5625rem]"
          >
            {count}
          </text>
        ))}
        {segments.map((points) => (
          <polyline
            key={points}
            data-series="judge-score"
            points={points}
            fill="none"
            className="stroke-primary"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        ))}
        <polyline
          data-series="thumbs-up"
          points={thumbsUpPoints}
          fill="none"
          className="stroke-semantic-success"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        <polyline
          data-series="thumbs-down"
          points={thumbsDownPoints}
          fill="none"
          className="stroke-semantic-destructive"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        {daily.map((day, index) => {
          const date = formatDate(day.date);
          return (
            <g key={day.date}>
              {day.avgScore === null ? null : (
                <circle
                  cx={x(index)}
                  cy={scoreY(day.avgScore)}
                  r={2}
                  className="fill-primary"
                >
                  <title>
                    {labels.scorePoint(date, day.avgScore, day.turns)}
                  </title>
                </circle>
              )}
              {day.thumbsUp === 0 ? null : (
                <circle
                  cx={x(index)}
                  cy={thumbsY(day.thumbsUp)}
                  r={2}
                  className="fill-semantic-success"
                >
                  <title>{labels.thumbsUpPoint(date, day.thumbsUp)}</title>
                </circle>
              )}
              {day.thumbsDown === 0 ? null : (
                <circle
                  cx={x(index)}
                  cy={thumbsY(day.thumbsDown)}
                  r={2}
                  className="fill-semantic-destructive"
                >
                  <title>{labels.thumbsDownPoint(date, day.thumbsDown)}</title>
                </circle>
              )}
            </g>
          );
        })}
        {dateTicks.map((index) => {
          const day = daily[index];
          if (!day) return null;
          return (
            <text
              key={day.date}
              x={x(index)}
              y={HEIGHT - 5}
              textAnchor={
                index === 0
                  ? "start"
                  : index === daily.length - 1
                    ? "end"
                    : "middle"
              }
              className="fill-muted-foreground text-[0.5625rem]"
            >
              {formatDate(day.date)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export async function QualityOverview({
  quality,
  selectedVersionId = null,
}: {
  quality: AdminSokoBotQuality;
  selectedVersionId?: string | null;
}) {
  const [t, formatter] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Quality"),
    getFormatter(),
  ]);
  function formatDate(date: string): string {
    return formatter.dateTime(new Date(`${date}T00:00:00.000Z`), {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  }
  const visibleVersions = selectedVersionId
    ? quality.versions.filter(
        (version) => version.versionId === selectedVersionId,
      )
    : quality.versions;
  return (
    <section className="bg-background rounded-lg border">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div className="space-y-2">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold leading-5">{t("title")}</h2>
            <p className="text-muted-foreground text-xs">{t("description")}</p>
          </div>
          <QualityVersionFilter
            selectedVersionId={selectedVersionId}
            versions={quality.versions}
          />
        </div>
        <p className="text-right text-xs tabular-nums">
          <span
            className={cn(
              "text-xl font-semibold",
              scoreTone(quality.overall.avgScore),
            )}
          >
            {quality.overall.avgScore ?? "—"}
          </span>
          <span className="text-muted-foreground block">
            {t("overall", {
              judged: quality.overall.judged,
              turns: quality.overall.turns,
            })}
          </span>
          <span className="text-muted-foreground block">
            {t("proactive", {
              sent: quality.proactive.sent,
              actedOn: quality.proactive.actedOn,
            })}
            {" · "}
            {t("thumbs", {
              up: quality.proactive.thumbsUp,
              down: quality.proactive.thumbsDown,
            })}
          </span>
        </p>
      </header>
      <div className="px-4 py-3">
        <ScoreChart
          daily={quality.daily}
          formatDate={formatDate}
          labels={{
            chart: t("chartLabel"),
            countAxis: t("countAxis"),
            scoreLegend: t("legendScore"),
            thumbsDownLegend: t("legendThumbsDown"),
            thumbsUpLegend: t("legendThumbsUp"),
            scorePoint: (date, score, turns) =>
              t("scorePoint", { date, score, turns }),
            thumbsDownPoint: (date, count) =>
              t("thumbsDownPoint", { date, count }),
            thumbsUpPoint: (date, count) => t("thumbsUpPoint", { date, count }),
          }}
        />
      </div>
      <div className="overflow-x-auto border-t">
        <table className="w-full text-xs">
          <caption className="text-muted-foreground px-4 py-2 text-left font-medium">
            {t("realRunsByVersion")}
          </caption>
          <thead className="text-muted-foreground">
            <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
              <th>{t("version")}</th>
              <th className="text-right!">{t("turns")}</th>
              <th className="text-right!">{t("avgScore")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visibleVersions.map((version) => (
              <tr
                key={version.versionId}
                className="[&>td]:px-4 [&>td]:py-2 [&>td]:tabular-nums"
              >
                <td>
                  <span className="font-medium">{version.versionId}</span>
                  {version.name ? (
                    <span className="text-muted-foreground ml-2">
                      {version.name}
                    </span>
                  ) : null}
                </td>
                <td className="text-right">{version.turns}</td>
                <td
                  className={cn(
                    "text-right font-medium",
                    scoreTone(version.avgScore),
                  )}
                >
                  {version.avgScore ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
