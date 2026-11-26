import type { MarketingStrategyPlan, ScenarioCheck } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { cadencePerWeek } from "@/services/evals/eval-cmo-change-then-drafts";
import type { EvalLaneRecord } from "@/services/evals/eval-lanes.service";
import { parseMarketingPlan } from "@/services/marketing-strategy.service";

/** "LinkedIn twice a week, and make our X posts better": one clear part, one open. */
export const MIXED_REQUEST_CASE_ID = "cmo-mixed-clear-and-open";
/** "You decide which network and by how much": the choice is Cuso's. */
export const DELEGATED_CHOICE_CASE_ID = "cmo-owner-delegates-choice";

export const STRATEGY_REQUEST_CASE_IDS: readonly string[] = [
  MIXED_REQUEST_CASE_ID,
  DELEGATED_CHOICE_CASE_ID,
];

/** The strategy before the turn and the one saved during it, if any. */
export interface StrategyBeforeAfter {
  before: MarketingStrategyPlan | null;
  saved: MarketingStrategyPlan | null;
}

function cadences(plan: MarketingStrategyPlan | null): Map<string, string> {
  return new Map(
    (plan?.channels ?? []).map((channel) => [channel.channel, channel.cadence]),
  );
}

function entriesOn(plan: MarketingStrategyPlan | null, channel: string) {
  return JSON.stringify(
    (plan?.calendar ?? [])
      .filter((entry) => entry.channel === channel)
      .map(({ id, date, title, format }) => ({ id, date, title, format }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

/**
 * The clear part saved, the open part left as it was. Only a version saved
 * during the turn counts: a failed save leaves none, so nothing passes.
 */
export function mixedRequestChecks(
  input: StrategyBeforeAfter,
): ScenarioCheck[] {
  const linkedin = cadences(input.saved).get("linkedin") ?? null;
  const perWeek = linkedin === null ? null : cadencePerWeek(linkedin);
  const xBefore = cadences(input.before).get("x") ?? null;
  const xAfter = cadences(input.saved).get("x") ?? null;
  const xKept =
    input.saved !== null &&
    xBefore === xAfter &&
    entriesOn(input.before, "x") === entriesOn(input.saved, "x");
  return [
    {
      label: "Saves LinkedIn at two posts a week",
      pass: perWeek === 2,
      actual:
        input.saved === null
          ? "no strategy saved this turn"
          : `"${linkedin ?? "no LinkedIn channel"}" (${perWeek ?? "no period"} a week)`,
    },
    {
      label: "Leaves X as it was until the owner answers",
      pass: xKept,
      actual:
        input.saved === null
          ? "no strategy saved this turn"
          : xKept
            ? "X cadence and entries unchanged"
            : `X cadence "${xBefore}" → "${xAfter}", entries ${entriesOn(input.before, "x") === entriesOn(input.saved, "x") ? "unchanged" : "changed"}`,
    },
  ];
}

/** A saved change to some network's cadence; which one is Cuso's choice. */
export function delegatedChoiceChecks(
  input: StrategyBeforeAfter,
): ScenarioCheck[] {
  const before = cadences(input.before);
  const changed = [...cadences(input.saved)].filter(([channel, cadence]) => {
    const was = before.get(channel);
    if (was === undefined) return true;
    const [now, then] = [cadencePerWeek(cadence), cadencePerWeek(was)];
    return now !== null && then !== null ? now !== then : cadence !== was;
  });
  return [
    {
      label: "Saves a change to how often a network posts",
      pass: input.saved !== null && changed.length > 0,
      actual:
        input.saved === null
          ? "no strategy saved this turn"
          : changed.length === 0
            ? "every cadence as it was"
            : changed
                .map(
                  ([channel, cadence]) =>
                    `${channel} "${before.get(channel) ?? "new"}" → "${cadence}"`,
                )
                .join(", "),
    },
  ];
}

/**
 * The newest version from before the case started, and the newest version
 * written since (a turn's saves go to a version of its own), if any.
 */
async function strategyBeforeAfter(
  lane: EvalLaneRecord,
  startedAt: Date,
): Promise<StrategyBeforeAfter> {
  const [before, saved] = await Promise.all(
    [{ lt: startedAt }, { gte: startedAt }].map((createdAt) =>
      prisma.marketingStrategy.findFirst({
        where: { projectId: lane.cusoProjectId, createdAt },
        orderBy: { createdAt: "desc" },
        select: { plan: true },
      }),
    ),
  );
  return {
    before: parseMarketingPlan(before?.plan),
    saved: parseMarketingPlan(saved?.plan),
  };
}

export async function cmoStrategyRequestChecks(
  caseId: string,
  lane: EvalLaneRecord,
  startedAt: Date,
): Promise<ScenarioCheck[]> {
  const state = await strategyBeforeAfter(lane, startedAt);
  return caseId === MIXED_REQUEST_CASE_ID
    ? mixedRequestChecks(state)
    : delegatedChoiceChecks(state);
}
