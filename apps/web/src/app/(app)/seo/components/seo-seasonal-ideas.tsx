"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { SeoActionTaskButton } from "./seo-action-finding";
import {
  seasonalIdeaTiming,
  useSeasonalClock,
} from "./seo-seasonal-ideas-model";
import {
  SeoFoldSummary,
  SeoPageText,
  SeoSection,
  seoMarketName,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoSeasonalIdeas({ model }: { model: SeoWorkspaceModel }) {
  const tActions = useTranslations("App.Seo.actions");
  const t = useTranslations("App.Seo.keywords.seasonal");
  const format = useFormatter();
  const locale = useLocale();
  const now = useSeasonalClock(!!model.data.seasonalIdeas?.length);
  if (!model.data.seasonalIdeas?.length) return null;
  const query = model.keywordSearch.trim().toLocaleLowerCase(locale);
  const ideas = model.data.seasonalIdeas.filter((idea) =>
    [idea.keyword, idea.event?.name].some((label) =>
      label?.toLocaleLowerCase(locale).includes(query),
    ),
  );
  if (!ideas.length) return null;
  const month = (period: string) =>
    format.dateTime(new Date(period + "-01T12:00:00Z"), {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  const day = (value: Date | string) =>
    format.dateTime(new Date(value), { dateStyle: "medium", timeZone: "UTC" });
  return (
    <SeoSection
      title={t("title")}
      description={
        ideas.some(
          (idea) =>
            idea.windows.length ||
            idea.comparison?.status === "above_baseline" ||
            idea.comparison?.status === "no_observed_rise",
        )
          ? t("timing")
          : undefined
      }
      strong
    >
      <ul className="divide-y">
        {ideas.map((idea) => {
          const comparison = idea.comparison;
          const counts = [
            comparison?.leadMonth,
            comparison?.eventMonth,
          ].flatMap((row) =>
            row?.volume == null
              ? []
              : [t("count", { month: month(row.period), volume: row.volume })],
          );
          const status = comparison?.status;
          const hasComparison =
            status === "above_baseline" || status === "no_observed_rise";
          const timing = seasonalIdeaTiming(idea, now);
          const action = model.data.actions.find(
            (row) => row.id === idea.actionId,
          );
          const noWindowRise =
            !idea.event && !idea.windows.length && timing.observed.length > 0;
          // What to confirm before acting, as one list: separate grey lines
          // read like more evidence and hid where the checks begin.
          const checks = [
            ...((!hasComparison && !idea.windows.length) ||
            idea.limitations.includes("demand_unverified")
              ? (["verifyDemand"] as const)
              : []),
            ...idea.limitations.filter(
              (limit) =>
                limit !== "timing_uncertain" && limit !== "demand_unverified",
            ),
          ];
          return (
            <li
              key={JSON.stringify([
                idea.url,
                idea.country,
                idea.language,
                idea.keyword,
                idea.audience,
                idea.event?.date,
              ])}
              className="space-y-1 px-2 py-3 wrap-anywhere"
            >
              <h3 className="text-sm font-medium">
                <bdi>{idea.keyword}</bdi>
              </h3>
              {/* Market and audit date sit under the search they qualify. */}
              <p className="text-muted-foreground text-xs">
                {t("audit", {
                  market: seoMarketName(locale, idea.country, idea.language),
                  date: day(idea.asOf),
                })}
              </p>
              {idea.event && (
                <>
                  <p className="text-sm font-medium">
                    {t("datedEvent", {
                      event: idea.event.name,
                      date: day(idea.event.date),
                    })}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {idea.event.scope}
                  </p>
                </>
              )}
              {timing.upcoming.length > 0 && (
                <p className="text-sm font-medium">
                  {t("planFor", {
                    months: format.list(timing.upcoming.map(month)),
                  })}
                </p>
              )}
              {timing.passed && (
                <p className="text-sm font-medium">
                  {t("passed", {
                    timing: idea.event
                      ? day(idea.event.date)
                      : format.list(timing.passedMonths.map(month)),
                  })}
                </p>
              )}
              <p className="text-sm">
                {idea.origin === "market_history"
                  ? t("historicalIdea")
                  : t(idea.action, { audience: idea.audience })}
              </p>
              {action?.status === "unavailable" && (
                <p className="text-muted-foreground text-sm">
                  {tActions("unavailable")}
                </p>
              )}
              {action && (action.taskId || !timing.passed) && (
                <SeoActionTaskButton action={action} model={model} />
              )}
              {(hasComparison || idea.windows.length > 0 || noWindowRise) && (
                <p className="text-muted-foreground text-sm">
                  {t(
                    hasComparison
                      ? status
                      : noWindowRise
                        ? "noWindowRise"
                        : "windowRise",
                  )}
                </p>
              )}
              {checks.length > 0 && (
                <ul className="text-muted-foreground list-disc space-y-0.5 ps-5 text-sm">
                  {checks.map((check) => (
                    <li key={check}>{t(check)}</li>
                  ))}
                </ul>
              )}
              <details className="text-sm">
                <SeoFoldSummary className="text-muted-foreground min-h-10 w-fit font-medium">
                  {t("evidence")}
                </SeoFoldSummary>
                <div className="space-y-2 pb-2">
                  <SeoPageText url={idea.url} workspace={model.data} />
                  <blockquote className="border-s-2 ps-3">
                    {idea.pageQuote}
                  </blockquote>
                  {idea.windows.map((window) => (
                    <p key={window.targetPeriod}>
                      {t(window.referenceMonths ? "windowOther" : "window", {
                        months: format.list(
                          (window.referenceMonths ?? []).map(month),
                        ),
                        target: month(window.targetPeriod),
                        prior: month(window.historicalPeriod),
                        volume: window.historicalVolume,
                        baseline: window.baselineMedian,
                      })}
                    </p>
                  ))}
                  {counts.length > 0 && !hasComparison && (
                    <p>
                      {t("incompleteComparison", {
                        counts: format.list(counts),
                      })}
                    </p>
                  )}
                  {timing.observed.length > 0 && (
                    <p>
                      {t("observed", {
                        counts: format.list(
                          timing.observed.map((row) =>
                            t("count", {
                              month: month(row.period),
                              volume: row.volume,
                            }),
                          ),
                        ),
                      })}
                    </p>
                  )}
                  {hasComparison && comparison?.baselineMedian != null && (
                    <p>
                      {t("comparison", {
                        counts: format.list(counts),
                        baseline: comparison.baselineMedian,
                      })}
                    </p>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </SeoSection>
  );
}
