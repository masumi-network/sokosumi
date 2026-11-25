import type {
  CmoCalendarEntry,
  MarketingStrategyPlan,
} from "@sokosumi/soko-bot";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import { cmoPlanMonthSlots } from "@/services/cmo-month-slots";
import {
  cmoMonthCalendarChecks,
  examplesFromTomorrow,
} from "./eval-cmo-month-calendar";

const START = "2026-12-01";

const examples: CmoCalendarEntry[] = [
  ["ex-1", "linkedin", "image", "Launch planning", "educational", "awareness"],
  ["ex-2", "x", "image", "Fees and costs", "promotional", "action"],
  ["ex-3", "tiktok", "video", "Market news", "educational", "interest"],
].map(([id, channel, format, pillar, approach, stage]) => ({
  id: id!,
  date: START,
  time: "10:00",
  channel: channel!,
  format: format!,
  status: "idea" as const,
  title: `Example ${id}`,
  brief: `What ${id} shows`,
  pillar,
  approach: approach as CmoCalendarEntry["approach"],
  stage: stage as CmoCalendarEntry["stage"],
  ...(channel === "tiktok" ? { alsoOn: ["instagram", "youtube"] } : {}),
}));

const strategy = {
  channels: ["x", "linkedin", "instagram", "tiktok", "youtube"].map(
    (channel) => ({ channel, cadence: "top rate" }),
  ),
  pillars: [
    { name: "Launch planning", share: 40 },
    { name: "Fees and costs", share: 35 },
    { name: "Market news", share: 25 },
  ],
  mix: [
    { approach: "educational", share: 70, why: "Help" },
    { approach: "promotional", share: 30, why: "Offer" },
  ],
  calendar: examples,
} as unknown as MarketingStrategyPlan;

/** The month as Core's writer leaves it: every slot with its own words. */
function written(level: "steady" | "all_in"): MarketingStrategyPlan {
  const slots = cmoPlanMonthSlots({ plan: strategy, level, start: START });
  return {
    ...strategy,
    calendar: [
      ...examples,
      ...slots.map((slot) => ({
        ...slot,
        status: "idea" as const,
        title: `Post ${slot.id}`,
        brief: "b",
      })),
    ],
    monthWriter: { state: "written", level, start: START, attempts: 1 },
  };
}

const none = async () => ({ ids: new Set<string>(), costUsd: 0 });

describe("the month calendar case's checks", () => {
  it.each(["steady", "all_in"] as const)(
    "pass a whole %s month written to the plan",
    async (level) => {
      const { checks, output } = await cmoMonthCalendarChecks({
        plan: written(level),
        examples,
        level,
        repeats: none,
      });
      expect(checks.filter((check) => !check.pass)).toEqual([]);
      expect(output.posts).toBeGreaterThanOrEqual(output.floor as number);
    },
  );

  it("fail a month short of its floor, one off its pillars, repeats and a changed example", async () => {
    const plan = written("steady");
    const short = {
      ...plan,
      calendar: plan.calendar
        .filter((entry) => !(entry.channel === "x" && entry.date === START))
        .map((entry) =>
          entry.id === "ex-1"
            ? { ...entry, title: "Rewritten" }
            : entry.channel === "x"
              ? { ...entry, pillar: "Launch planning" }
              : entry,
        ),
    };
    const { checks } = await cmoMonthCalendarChecks({
      plan: short,
      examples,
      level: "steady",
      repeats: async (month) => ({
        ids: new Set(month.slice(10, 30).map((entry) => entry.id)),
        costUsd: 0,
      }),
    });
    const failed = checks
      .filter((check) => !check.pass)
      .map((check) => check.label);
    expect(failed).toEqual([
      "Holds at least the plan's floor",
      "Every pillar and approach at its share, in the month and on every network",
      "No post repeats another's point, across the parallel calls",
      "Keeps the strategy's examples word for word",
    ]);
  });

  it("starts the examples tomorrow and marks the plan as Core's to write", () => {
    const plan = examplesFromTomorrow(
      strategy,
      new Date("2026-12-01T10:00:00Z"),
    );
    expect(plan.monthWriter).toEqual({ state: "examples", attempts: 0 });
    expect(new Set(plan.calendar.map((entry) => entry.date))).toEqual(
      new Set(["2026-12-02"]),
    );
  });
});
