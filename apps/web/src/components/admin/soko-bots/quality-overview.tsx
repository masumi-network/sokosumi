import { getTranslations } from "next-intl/server";

import type { AdminSokoBotQuality } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

const WIDTH = 640;
const HEIGHT = 140;
const PAD = 16;

function scoreTone(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 4) return "text-semantic-success";
  if (score >= 3) return "text-semantic-warning";
  return "text-semantic-destructive";
}

/** Average judge score per day, drawn inline; gaps for days without judged turns. */
function ScoreChart({ daily }: { daily: AdminSokoBotQuality["daily"] }) {
  const step = (WIDTH - PAD * 2) / Math.max(1, daily.length - 1);
  const y = (score: number) =>
    HEIGHT - PAD - ((score - 1) / 4) * (HEIGHT - PAD * 2);
  const segments: string[] = [];
  let current: string[] = [];
  daily.forEach((day, index) => {
    if (day.avgScore === null) {
      if (current.length) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${PAD + index * step},${y(day.avgScore)}`);
  });
  if (current.length) segments.push(current.join(" "));
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-36 w-full"
      role="img"
      aria-label="Average judge score per day"
    >
      {[1, 2, 3, 4, 5].map((score) => (
        <g key={score}>
          <line
            x1={PAD}
            x2={WIDTH - PAD}
            y1={y(score)}
            y2={y(score)}
            className="stroke-border"
            strokeWidth={0.5}
          />
          <text
            x={2}
            y={y(score) + 3}
            className="fill-muted-foreground text-[0.5625rem]"
          >
            {score}
          </text>
        </g>
      ))}
      {segments.map((points) => (
        <polyline
          key={points}
          points={points}
          fill="none"
          className="stroke-primary"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      ))}
      {daily.map((day, index) =>
        day.avgScore === null ? null : (
          <circle
            key={day.date}
            cx={PAD + index * step}
            cy={y(day.avgScore)}
            r={2}
            className="fill-primary"
          >
            <title>{`${day.date}: ${day.avgScore} (${day.turns} turns)`}</title>
          </circle>
        ),
      )}
    </svg>
  );
}

/** Fleet-wide judge scores: trend over 30 days, then per agent version. */
export async function QualityOverview({
  quality,
}: {
  quality: AdminSokoBotQuality;
}) {
  const t = await getTranslations("App.Admin.SokoBots.Quality");
  return (
    <section className="bg-background rounded-lg border">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold leading-5">{t("title")}</h2>
          <p className="text-muted-foreground text-xs">{t("description")}</p>
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
        </p>
      </header>
      <div className="px-4 py-3">
        <ScoreChart daily={quality.daily} />
      </div>
      <div className="overflow-x-auto border-t">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
              <th>{t("version")}</th>
              <th className="text-right!">{t("turns")}</th>
              <th className="text-right!">{t("avgScore")}</th>
              <th className="text-right!">{t("labRuns")}</th>
              <th className="text-right!">{t("labPassRate")}</th>
              <th className="text-right!">{t("labJudge")}</th>
              <th>{t("verdicts")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {quality.versions.map((version) => (
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
                <td className="text-right">{version.labRuns}</td>
                <td className="text-right">
                  {version.labPassRate === null
                    ? "—"
                    : `${version.labPassRate}%`}
                </td>
                <td
                  className={cn("text-right", scoreTone(version.labAvgJudge))}
                >
                  {version.labAvgJudge ?? "—"}
                </td>
                <td className="text-muted-foreground">
                  <span className="text-semantic-success">
                    {version.labVerdicts.pass}
                  </span>
                  {" / "}
                  <span className="text-semantic-warning">
                    {version.labVerdicts.weak}
                  </span>
                  {" / "}
                  <span className="text-semantic-destructive">
                    {version.labVerdicts.fail}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
