import type { ProjectSeoAction } from "@sokosumi/core-client";
import { seasonalUpdateHasPassed, seoSeasonalTiming } from "@sokosumi/utils";
import { useNow } from "next-intl";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

type SeasonalIdea = NonNullable<
  SeoWorkspaceModel["data"]["seasonalIdeas"]
>[number];

/** One year of the query's monthly estimates is enough to read its pattern. */
export const SEASONAL_SHOWN_MONTHS = 12;

const MARKET_CLOCK_REFRESH_MS = 60_000;

export function useSeasonalClock(hasSeasonalDates: boolean) {
  return useNow({
    updateInterval: hasSeasonalDates ? MARKET_CLOCK_REFRESH_MS : undefined,
  });
}

export function seasonalIdeaTiming(idea: SeasonalIdea, now: Date) {
  const timing = seoSeasonalTiming(idea, now);
  const target = timing.upcoming.toSorted()[0];
  const preparation = target && new Date(target + "-01T12:00:00Z");
  if (preparation) preparation.setUTCMonth(preparation.getUTCMonth() - 1);
  const previous = preparation ? preparation.toISOString().slice(0, 7) : null;
  return {
    ...timing,
    prepareFrom:
      previous && previous > timing.currentMonth
        ? previous
        : timing.currentMonth,
    observed: (idea.observedMonths ?? []).slice(-SEASONAL_SHOWN_MONTHS),
  };
}

/** Summarize identical comparisons once. A zero baseline supports an absolute count only. */
export function seasonalPlanningSignal(idea: SeasonalIdea, upcoming: string[]) {
  const windows = idea.windows.filter((w) => upcoming.includes(w.targetPeriod));
  const first = windows[0];
  if (!first) return null;
  const matching = windows.filter(
    (w) =>
      w.historicalVolume === first.historicalVolume &&
      w.baselineMedian === first.baselineMedian &&
      !!w.earlierCycle === !!first.earlierCycle,
  );
  const rise =
    first.baselineMedian > 0
      ? Math.round(
          (100 * (first.historicalVolume - first.baselineMedian)) /
            first.baselineMedian,
        )
      : null;
  const key =
    rise === null
      ? "zeroSignal"
      : first.earlierCycle
        ? "repeatSignal"
        : "singleSignal";
  return {
    key,
    rise,
    count: first.historicalVolume,
    months: matching.map((w) => w.historicalPeriod),
    trends:
      idea.trendComparison?.filter((row) =>
        windows.some((w) => w.historicalPeriod === row.historicalPeriod),
      ) ?? [],
  } as const;
}

/** Surface a usable editorial plan first. Repeated evidence breaks ties between equally actionable ideas. */
export function seasonalPlanningOrder(idea: SeasonalIdea, now: Date) {
  if (seasonalIdeaTiming(idea, now).passed) return 4;
  if (idea.marketBasis) return 3;
  if (idea.contentPlan?.experiment || idea.actionId) return 0;
  if (
    idea.windows.some((w) => w.earlierCycle) ||
    idea.comparison?.earlierEdition
  )
    return 1;
  return 2;
}

export function canDraftSeoAction(
  data: SeoWorkspaceModel["data"],
  action: ProjectSeoAction,
  now: Date,
) {
  if (!data.availableActions.canEdit || action.status !== "recommended")
    return false;
  if (!action.id.startsWith("seasonal:")) return true;
  const idea = data.seasonalIdeas?.find((row) => row.actionId === action.id);
  return !!idea && !seasonalUpdateHasPassed(idea, now);
}
