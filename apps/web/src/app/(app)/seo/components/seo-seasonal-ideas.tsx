"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  SeoFoldSummary,
  SeoPageText,
  SeoSection,
  seoMarketName,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoSeasonalIdeas({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo.keywords.seasonal");
  const format = useFormatter();
  const locale = useLocale();
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
              className="space-y-1 px-2 py-3"
            >
              <h3 className="text-sm font-medium">
                <bdi>{idea.keyword}</bdi>
              </h3>
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
              {idea.windows.length > 0 && (
                <p className="text-sm font-medium">
                  {t("planFor", {
                    months: format.list(
                      idea.windows.map((window) => month(window.targetPeriod)),
                    ),
                  })}
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                {t("audit", {
                  market: seoMarketName(locale, idea.country, idea.language),
                  date: day(idea.asOf),
                })}
              </p>
              <p className="text-sm">
                {idea.origin === "market_history"
                  ? t("historicalIdea")
                  : t(idea.action, { audience: idea.audience })}
              </p>
              {(hasComparison || idea.windows.length > 0) && (
                <p className="text-muted-foreground text-sm">
                  {t(hasComparison ? status : "windowRise")}
                </p>
              )}
              {((!hasComparison && !idea.windows.length) ||
                idea.limitations.includes("demand_unverified")) && (
                <p className="text-muted-foreground text-sm">
                  {t("verifyDemand")}
                </p>
              )}
              {idea.limitations
                .filter(
                  (limit) =>
                    limit !== "timing_uncertain" &&
                    limit !== "demand_unverified",
                )
                .map((limit) => (
                  <p className="text-muted-foreground text-sm" key={limit}>
                    {t(limit)}
                  </p>
                ))}
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
