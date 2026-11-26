import { describe, expect, it } from "vitest";
import { selectEvalCases } from "../eval-cases";
import { cronDays, nextWeekdayKey } from "./journey-checks";
import { countRetries, journeyScore, type StepRecord } from "./journey-runner";
import { OWNER_JOURNEYS } from "./journeys";

describe("owner journeys", () => {
  it("has unique ids and starts each with the owner", () => {
    const ids = OWNER_JOURNEYS.map((journey) => journey.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const journey of OWNER_JOURNEYS)
      expect(journey.steps[0]?.kind, journey.id).toBe("owner");
  });

  it("gives Cuso journeys a Cuso world and Soko Bot journeys none", () => {
    for (const journey of OWNER_JOURNEYS)
      expect(Boolean(journey.cusoSetup), journey.id).toBe(
        journey.bot === "cuso",
      );
  });

  it("runs only when named, never in a suite run", () => {
    const suite = selectEvalCases({ suites: ["soko-bot", "cmo"], caseIds: [] });
    expect(suite.some((evalCase) => evalCase.kind === "journey")).toBe(false);
    const named = selectEvalCases({
      suites: ["soko-bot"],
      caseIds: ["owner-codepat-daily-post"],
    });
    expect(named.map((evalCase) => evalCase.id)).toEqual([
      "owner-codepat-daily-post",
    ]);
  });
});

describe("cronDays", () => {
  it.each([
    ["0 9 * * *", [0, 1, 2, 3, 4, 5, 6]],
    ["0 9 * * 1-5", [1, 2, 3, 4, 5]],
    ["30 7 * * 1", [1]],
    ["0 9 * * 0-4,6", [0, 1, 2, 3, 4, 6]],
    ["0 9 * * SAT-THU", [0, 1, 2, 3, 4, 6]],
    ["0 9 * * 7", [0]],
  ])("%s", (cron, days) => {
    expect(cronDays(cron)).toEqual(days);
  });
});

it("finds the next weekday after a date in Berlin", () => {
  // Wednesday 2026-11-25 → next Tuesday is 2026-12-01.
  expect(nextWeekdayKey(new Date("2026-11-25T10:00:00Z"), 2)).toBe(
    "2026-12-01",
  );
});

it("counts calls that come after a failed call of the same tool", () => {
  expect(
    countRetries([
      { capability: "update_social_post", status: "FAILED" },
      { capability: "update_social_post", status: "FAILED" },
      { capability: "update_social_post", status: "COMPLETED" },
      { capability: "create_schedule", status: "COMPLETED" },
    ]),
  ).toBe(2);
});

it("scores progress by steps in a row and checks", () => {
  const journey = OWNER_JOURNEYS[0]!;
  const step = (index: number, pass: boolean): StepRecord => ({
    index,
    kind: "owner",
    label: "",
    startedAt: "",
    turnIds: [],
    passed: pass,
    checks: [{ label: "x", pass, actual: "" }],
  });
  expect(
    journeyScore(journey, [step(0, true), step(1, false), step(2, true)]),
  ).toEqual({
    stepsTotal: journey.steps.length,
    stepsRun: 3,
    stepsPassed: 2,
    reached: 1,
    checksPassed: 2,
    checksTotal: 3,
  });
});
