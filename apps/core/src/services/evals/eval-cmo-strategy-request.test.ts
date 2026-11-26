import type { MarketingStrategyPlan } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeRequestPlan } from "./eval-cmo-runner";
import {
  cmoStrategyRequestChecks,
  DELEGATED_CHOICE_CASE_ID,
  delegatedChoiceChecks,
  MIXED_REQUEST_CASE_ID,
  mixedRequestChecks,
} from "./eval-cmo-strategy-request";
import type { EvalLaneRecord } from "./eval-lanes.service";

type Row = { authorTurnId: string | null; plan: unknown; createdAt: number };
const rows: Row[] = [];
vi.mock("@/lib/db/prisma", () => ({
  default: {
    marketingStrategy: {
      // The two lookups the grader makes: by its turn, or by any other author.
      findFirst: async ({
        where,
      }: {
        where: {
          authorTurnId?: string;
          OR?: [unknown, { authorTurnId: { not: string } }];
        };
      }) =>
        rows
          .filter((row) =>
            where.OR
              ? row.authorTurnId !== where.OR[1].authorTurnId.not
              : row.authorTurnId === where.authorTurnId,
          )
          .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
    },
  },
}));

const entry = (id: string, channel: string, title: string) => ({
  id,
  channel,
  title,
  date: "2026-12-01",
  format: "post",
});
const plan = (
  channels: Record<string, string>,
  calendar = [
    entry("x1", "x", "Booking in one click"),
    entry("li1", "linkedin", "Routing"),
  ],
) =>
  ({
    channels: Object.entries(channels).map(([channel, cadence]) => ({
      channel,
      cadence,
    })),
    calendar,
  }) as unknown as MarketingStrategyPlan;

const BEFORE = plan({ linkedin: "3 posts a week", x: "1 a day" });
const failedLabels = (checks: { label: string; pass: boolean }[]) =>
  checks.filter((check) => !check.pass).map((check) => check.label);

describe("a mixed strategy request", () => {
  it("passes LinkedIn saved at twice a week with X untouched", () => {
    const saved = plan({ linkedin: "2 posts a week", x: "1 a day" });
    expect(failedLabels(mixedRequestChecks({ before: BEFORE, saved }))).toEqual(
      [],
    );
  });

  it("fails when only a failed save happened (nothing saved)", () => {
    expect(
      failedLabels(mixedRequestChecks({ before: BEFORE, saved: null })),
    ).toEqual([
      "Saves LinkedIn at two posts a week",
      "Leaves X as it was until the owner answers",
    ]);
  });

  it("fails when X was rewritten on a guess", () => {
    const saved = plan({ linkedin: "2 posts a week", x: "1 a day" }, [
      entry("x1", "x", "Why demos stall"),
      entry("li1", "linkedin", "Routing"),
    ]);
    expect(failedLabels(mixedRequestChecks({ before: BEFORE, saved }))).toEqual(
      ["Leaves X as it was until the owner answers"],
    );
  });
});

describe("a choice the owner left to Cuso", () => {
  it("passes any network whose cadence changed", () => {
    const saved = plan({ linkedin: "5 posts a week", x: "1 a day" });
    expect(
      failedLabels(delegatedChoiceChecks({ before: BEFORE, saved })),
    ).toEqual([]);
  });

  it("fails a failed save and a save that changed no cadence", () => {
    const label = ["Saves a change to how often a network posts"];
    expect(
      failedLabels(delegatedChoiceChecks({ before: BEFORE, saved: null })),
    ).toEqual(label);
    const same = plan({ linkedin: "three a week", x: "daily" });
    expect(
      failedLabels(delegatedChoiceChecks({ before: BEFORE, saved: same })),
    ).toEqual(label);
  });
});

describe("what the case's own turn saved", () => {
  const TURN = "case-turn";
  const lane = { cusoProjectId: "project" } as EvalLaneRecord;
  const seed = changeRequestPlan(new Date("2026-12-01T00:00:00Z"));
  const withCadence = (channel: string, cadence: string) => ({
    ...seed,
    channels: seed.channels.map((row) =>
      row.channel === channel ? { ...row, cadence } : row,
    ),
  });
  const failedLabels = async (caseId: string) =>
    (await cmoStrategyRequestChecks(caseId, lane, TURN))
      .filter((check) => !check.pass)
      .map((check) => check.label);

  beforeEach(() => {
    rows.length = 0;
    // The fixture's seed, made after the case clock started.
    rows.push({ authorTurnId: null, plan: seed, createdAt: 1 });
  });

  it("never counts the fixture's seed as a save", async () => {
    expect(await failedLabels(DELEGATED_CHOICE_CASE_ID)).toEqual([
      "Saves a change to how often a network posts",
    ]);
    expect(await failedLabels(MIXED_REQUEST_CASE_ID)).toHaveLength(2);
  });

  it("passes the turn's own save against the seed", async () => {
    rows.push({
      authorTurnId: TURN,
      plan: withCadence("linkedin", "2 posts a week"),
      createdAt: 2,
    });
    expect(await failedLabels(MIXED_REQUEST_CASE_ID)).toEqual([]);
    expect(await failedLabels(DELEGATED_CHOICE_CASE_ID)).toEqual([]);
  });

  it("fails rewritten X stories even with X's cadence and titles kept", async () => {
    const saved = withCadence("linkedin", "2 posts a week");
    rows.push({
      authorTurnId: TURN,
      plan: {
        ...saved,
        calendar: saved.calendar.map((entry) =>
          entry.channel === "x" ? { ...entry, story: "A new story" } : entry,
        ),
      },
      createdAt: 2,
    });
    expect(await failedLabels(MIXED_REQUEST_CASE_ID)).toEqual([
      "Leaves X as it was until the owner answers",
    ]);
  });

  it("ignores what Core fills in on a save", async () => {
    const saved = withCadence("linkedin", "2 posts a week");
    rows.push({
      authorTurnId: TURN,
      plan: {
        ...saved,
        calendar: saved.calendar.map((entry) => ({ ...entry, claim: "c1" })),
      },
      createdAt: 2,
    });
    expect(await failedLabels(MIXED_REQUEST_CASE_ID)).toEqual([]);
  });
});
