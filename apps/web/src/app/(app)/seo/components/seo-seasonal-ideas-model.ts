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
  return {
    ...seoSeasonalTiming(idea, now),
    observed: (idea.observedMonths ?? []).slice(-SEASONAL_SHOWN_MONTHS),
  };
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
