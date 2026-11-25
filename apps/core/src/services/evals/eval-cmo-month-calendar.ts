import type {
  CmoCalendarEntry,
  MarketingStrategyPlan,
  ScenarioCheck,
} from "@sokosumi/soko-bot";
import { type CmoVolumeLevel, cmoMonthFloor } from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";
import { jsonInput } from "@/helpers/prisma-json";
import prisma from "@/lib/db/prisma";
import { runAsBackgroundWork } from "@/lib/evlog";
import { findCusoForBot } from "@/services/cmo-cuso.service";
import {
  cmoMonthPostsPlanned,
  cmoMonthRepeats,
  runCmoMonthCalendar,
} from "@/services/cmo-month-calendar.service";
import { CMO_MONTH_DAYS, cmoSlotNetworks } from "@/services/cmo-month-slots";
import {
  mixProblems,
  pillarProblems,
} from "@/services/cmo-plan-review.service";
import {
  approveMarketingStrategy,
  parseMarketingPlan,
} from "@/services/marketing-strategy.service";

/**
 * cmo-v22's month after payment, on its own: an approved strategy with its
 * example posts, then Core's calendar writer at one plan level, on the real
 * model. No production follows, so the case costs only the writer's calls.
 * Checked in code: the month whole, at least the plan's floor, every pillar
 * and approach at its share on every network, every funnel step, no post
 * repeating another's point, and the examples kept word for word.
 */

const DAY_MS = 86_400_000;
/** A write takes a few minutes; past this it is a failure. */
export const MONTH_CALENDAR_TIMEOUT_MS = 25 * 60_000;
/** Repeats left after the writer's repair rounds, at most, as a share of posts. */
const MAX_REPEAT_SHARE = 0.02;

/** The examples moved to start tomorrow, the plan marked as Core's to write. */
export function examplesFromTomorrow(
  plan: MarketingStrategyPlan,
  now: Date,
): MarketingStrategyPlan {
  const day = new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
  return {
    ...plan,
    calendar: plan.calendar
      .filter((entry) => entry.status !== "skipped")
      .map((entry) => ({ ...entry, date: day, status: "idea" as const })),
    monthWriter: { state: "examples", attempts: 0 },
  };
}

export async function startCmoMonthCalendarCase(input: {
  lane: {
    cusoBotId: string;
    cusoProjectId: string;
    workspaceId: string;
    userId: string;
  };
  plan: MarketingStrategyPlan;
  level: CmoVolumeLevel;
}): Promise<{ strategyId: string }> {
  const cuso = await findCusoForBot(input.lane.cusoBotId);
  if (!cuso) throw new Error("The eval lane has no Cuso");
  const strategy = await prisma.marketingStrategy.create({
    data: {
      projectId: input.lane.cusoProjectId,
      plan: jsonInput(examplesFromTomorrow(input.plan, new Date())),
      authorSokoBotId: input.lane.cusoBotId,
    },
    select: { id: true },
  });
  await approveMarketingStrategy({
    projectId: input.lane.cusoProjectId,
    workspaceId: input.lane.workspaceId,
    userId: input.lane.userId,
    strategyId: strategy.id,
  });
  waitUntil(
    runAsBackgroundWork(() =>
      runCmoMonthCalendar(cuso, strategy.id, input.level, new Date(), {
        kickProduction: false,
      }).catch(() => false),
    ),
  );
  return { strategyId: strategy.id };
}

/** The month as checked: posts inside its four weeks, the examples first. */
function inMonth(plan: MarketingStrategyPlan): CmoCalendarEntry[] {
  const start = plan.monthWriter?.start;
  return plan.calendar.filter((entry) => {
    if (entry.status === "skipped") return false;
    if (!start) return true;
    const day = (Date.parse(entry.date) - Date.parse(start)) / DAY_MS;
    return day >= 0 && day < CMO_MONTH_DAYS;
  });
}

/** The written month's checks, against the strategy it was written from. */
export async function cmoMonthCalendarChecks(input: {
  plan: MarketingStrategyPlan;
  examples: readonly CmoCalendarEntry[];
  level: CmoVolumeLevel;
  repeats?: (
    month: readonly CmoCalendarEntry[],
  ) => Promise<{ ids: ReadonlySet<string> }>;
}): Promise<{ checks: ScenarioCheck[]; output: Record<string, unknown> }> {
  const { plan, level } = input;
  const month = inMonth(plan);
  const floor = cmoMonthFloor(plan.channels, level).total;
  const planned = cmoMonthPostsPlanned(month);
  const networks = [...new Set(month.map((entry) => entry.channel))];
  const offShare = networks.flatMap((network) => {
    const own = month.filter((entry) => entry.channel === network);
    // A handful of posts cannot hold every share.
    if (own.length < 20) return [];
    return [
      ...pillarProblems(plan.pillars, own),
      ...mixProblems(plan.mix, own),
    ].map((problem) => `${network}: ${problem}`);
  });
  const whole = [
    ...pillarProblems(plan.pillars, month),
    ...mixProblems(plan.mix, month),
  ];
  const stages = ["awareness", "interest", "desire", "action"] as const;
  const emptySteps = stages.filter(
    (stage) => !month.some((entry) => entry.stage === stage),
  );
  const repeats = await (input.repeats ?? cmoMonthRepeats)(month);
  const kept = input.examples.filter((example) => {
    const saved = plan.calendar.find((entry) => entry.id === example.id);
    return (
      saved?.title === example.title &&
      saved.brief === example.brief &&
      saved.pillar === example.pillar
    );
  });
  const long = month.filter(
    (entry) => entry.title.trim().split(/\s+/).length > 10,
  );
  const share = (pillar: string) => {
    const count = month.filter((entry) => entry.pillar === pillar).length;
    return Math.round((count / Math.max(1, month.length)) * 100);
  };
  const checks: ScenarioCheck[] = [
    {
      label: "Writes the whole month",
      pass: plan.monthWriter?.state === "written",
      actual: `${plan.monthWriter?.state ?? "none"}${plan.monthWriter?.error ? ` (${plan.monthWriter.error})` : ""}, attempt ${plan.monthWriter?.attempts ?? 0}`,
    },
    {
      label: "Holds at least the plan's floor",
      pass: planned >= floor,
      actual: `${planned} posts going out, floor ${floor} (${level})`,
    },
    {
      label:
        "Every pillar and approach at its share, in the month and on every network",
      pass: whole.length === 0 && offShare.length === 0,
      actual:
        [...whole, ...offShare].slice(0, 6).join(" · ") ||
        plan.pillars
          .map(
            (pillar) =>
              `${pillar.name} ${share(pillar.name)}% (planned ${pillar.share}%)`,
          )
          .join(", "),
    },
    {
      label: "Every funnel step has posts",
      pass: emptySteps.length === 0,
      actual: emptySteps.length
        ? `none at ${emptySteps.join(", ")}`
        : "all four",
    },
    {
      label: "No post repeats another's point, across the parallel calls",
      pass: repeats.ids.size <= Math.floor(month.length * MAX_REPEAT_SHARE),
      actual: `${repeats.ids.size} of ${month.length} repeat an earlier post`,
    },
    {
      label: "Keeps the strategy's examples word for word",
      pass: kept.length === input.examples.length,
      actual: `${kept.length} of ${input.examples.length} kept`,
    },
    {
      label: "Titles stay short",
      pass: long.length <= Math.ceil(month.length * 0.05),
      actual: `${long.length} titles over ten words`,
    },
  ];
  return {
    checks,
    output: {
      level,
      posts: planned,
      floor,
      entries: month.length,
      costUsd: plan.monthWriter?.costUsd ?? null,
      seconds:
        plan.monthWriter?.startedAt && plan.monthWriter.endedAt
          ? Math.round(
              (Date.parse(plan.monthWriter.endedAt) -
                Date.parse(plan.monthWriter.startedAt)) /
                1000,
            )
          : null,
      byNetwork: Object.fromEntries(
        networks.map((network) => [
          network,
          month
            .filter((entry) => entry.channel === network)
            .reduce((sum, entry) => sum + cmoSlotNetworks(entry).length, 0),
        ]),
      ),
      pillars: Object.fromEntries(
        plan.pillars.map((pillar) => [pillar.name, share(pillar.name)]),
      ),
      sample: month
        .filter((entry) => entry.id.startsWith("m-"))
        .filter((_, index) => index % 25 === 0)
        .map((entry) => `${entry.channel} · ${entry.pillar} · ${entry.title}`),
    },
  };
}

/** Where the case's write stands: still writing, or the checks. */
export async function pollCmoMonthCalendarCase(input: {
  strategyId: string;
  examples: readonly CmoCalendarEntry[];
  level: CmoVolumeLevel;
  startedAt: Date;
  now: Date;
}): Promise<
  | { kind: "waiting" }
  | { kind: "done"; checks: ScenarioCheck[]; output: Record<string, unknown> }
> {
  const version = await prisma.marketingStrategy.findUniqueOrThrow({
    where: { id: input.strategyId },
    select: { plan: true },
  });
  const plan = parseMarketingPlan(version.plan);
  if (!plan) throw new Error("The month calendar case's plan does not parse");
  const writer = plan.monthWriter;
  const ended =
    writer?.endedAt &&
    writer.startedAt &&
    Date.parse(writer.endedAt) >= Date.parse(writer.startedAt);
  const timedOut =
    input.now.getTime() - input.startedAt.getTime() >=
    MONTH_CALENDAR_TIMEOUT_MS;
  if (writer?.state !== "written" && !ended && !timedOut)
    return { kind: "waiting" };
  return {
    kind: "done",
    ...(await cmoMonthCalendarChecks({
      plan,
      examples: input.examples,
      level: input.level,
    })),
  };
}
