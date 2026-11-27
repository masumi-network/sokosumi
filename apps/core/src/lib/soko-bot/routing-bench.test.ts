import { readFileSync } from "node:fs";
import type { TurnClassification } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import {
  type AnswerCache,
  checkReplayCoverage,
  isRight,
  isRightToAct,
  outcomeOf,
  parseRoutingCases,
  type RoutingCall,
  type RoutingCase,
  routingReport,
  SpendGate,
  summarizeRouting,
} from "./routing-bench";

describe("replay coverage", () => {
  const cases = [
    { ...itemFor("READ"), id: "a" },
    { ...itemFor("READ"), id: "b" },
  ];
  const cache = (
    calls: { caseId: string; run: number }[],
    runs = 3,
  ): AnswerCache => ({
    questionsHash: "q",
    runs,
    createdAt: "",
    calls: calls.map((call) => ({ ...call, attempts: [], got: null })),
  });
  const full = ["a", "b"].flatMap((caseId) =>
    [1, 2, 3].map((run) => ({ caseId, run })),
  );

  it("accepts a cache that covers every case and run once", () => {
    expect(() => checkReplayCoverage(cases, cache(full), "q")).not.toThrow();
  });

  it("refuses one answer for two cases × three runs", () => {
    expect(() =>
      checkReplayCoverage(cases, cache([{ caseId: "a", run: 1 }]), "q"),
    ).toThrow(/misses 5 of 6/);
  });

  it("refuses duplicates, unknown cases, stray runs and other questions", () => {
    expect(() =>
      checkReplayCoverage(
        cases,
        cache([...full, { caseId: "a", run: 1 }]),
        "q",
      ),
    ).toThrow(/twice/);
    expect(() =>
      checkReplayCoverage(
        cases,
        cache([...full, { caseId: "z", run: 1 }]),
        "q",
      ),
    ).toThrow(/set lacks/);
    expect(() =>
      checkReplayCoverage(
        cases,
        cache([...full, { caseId: "a", run: 4 }]),
        "q",
      ),
    ).toThrow(/outside/);
    expect(() => checkReplayCoverage(cases, cache(full), "other")).toThrow(
      /other Jev questions/,
    );
  });
});

describe("spend gate", () => {
  it("sends nothing at a zero cap", () => {
    expect(new SpendGate(0, 0.002).admit()).toBe(false);
  });

  it("counts concurrent admissions and retries before they are sent", () => {
    const gate = new SpendGate(0.005, 0.002);
    expect(gate.admit()).toBe(true);
    expect(gate.admit()).toBe(true);
    expect(gate.admit()).toBe(false);
    gate.settle(0.0001);
    expect(gate.admit()).toBe(true);
    gate.settle(null);
    gate.settle(0.0001);
    expect(gate.spentUsd).toBeCloseTo(0.0022);
    expect(gate.admit()).toBe(true);
    expect(gate.admit()).toBe(false);
  });
});

describe("report", () => {
  it("counts a failed call as wrong", () => {
    const one = { ...itemFor("READ"), id: "r" };
    const summary = summarizeRouting(
      [one],
      [
        {
          caseId: "r",
          run: 1,
          got: "READ",
          jevRoute: null,
          jevConfidence: null,
          unsureRoute: null,
          complexity: null,
          costUsd: 0,
        },
        {
          caseId: "r",
          run: 2,
          got: null,
          jevRoute: null,
          jevConfidence: null,
          unsureRoute: null,
          complexity: null,
          costUsd: 0,
        },
      ],
    );
    expect(routingReport("t", summary)).toContain("| 2 | 50% | 50% |");
  });
});

function itemFor(want: RoutingCase["want"]): RoutingCase {
  return {
    id: want,
    category: "work",
    lang: "en",
    bot: "soko-bot",
    message: "m",
    want,
    complexity: "SIMPLE",
    source: "test",
  };
}

const routed = (
  route: TurnClassification["route"],
  writeScope?: TurnClassification["writeScope"],
) => ({ route, ...(writeScope ? { writeScope } : {}) }) as TurnClassification;

const item = (
  want: RoutingCase["want"],
  alt?: RoutingCase["alt"],
): RoutingCase => ({
  id: want,
  category: "work",
  lang: "en",
  bot: "soko-bot",
  message: "m",
  want,
  ...(alt ? { alt } : {}),
  complexity: "SIMPLE",
  source: "test",
});

const call = (
  caseId: string,
  got: RoutingCall["got"],
  run = 1,
): RoutingCall => ({
  caseId,
  run,
  got,
  jevRoute: null,
  jevConfidence: null,
  unsureRoute: got === "READ" ? "MANAGE_WORK" : null,
  complexity: "SIMPLE",
  costUsd: 0.0001,
});

describe("outcomeOf", () => {
  it("reads the grant the turn gets, not Jev's raw label", () => {
    expect(outcomeOf(routed("CLARIFY"))).toBe("ASK");
    expect(outcomeOf(routed("DIRECT_RESPONSE"))).toBe("READ");
    expect(outcomeOf(routed("MIXED"))).toBe("DELEGATE");
    expect(outcomeOf(routed("MANAGE_WORK", "SOCIAL"))).toBe("MANAGE:SOCIAL");
    expect(outcomeOf(routed("MANAGE_WORK"))).toBe("READ");
  });
});

describe("scoring", () => {
  it("ACT takes any write but a hire", () => {
    expect(isRight(item("ACT"), "MANAGE:WORK")).toBe(true);
    expect(isRight(item("ACT"), "DELEGATE")).toBe(true);
    expect(isRight(item("ACT"), "HIRE")).toBe(false);
    expect(isRight(item("ACT"), "ASK")).toBe(false);
  });

  it("a wrong scope is still right about acting", () => {
    expect(isRight(item("MANAGE:SOCIAL"), "MANAGE:WORK")).toBe(false);
    expect(isRightToAct(item("MANAGE:SOCIAL"), "MANAGE:WORK")).toBe(true);
    expect(isRightToAct(item("READ", ["ASK"]), "ASK")).toBe(true);
    expect(isRightToAct(item("MANAGE:SOCIAL"), "ASK")).toBe(false);
  });

  it("counts under-acts, threshold losses, flips and failures", () => {
    const cases = [item("MANAGE:SOCIAL"), item("READ")];
    const summary = summarizeRouting(cases, [
      call("MANAGE:SOCIAL", "READ", 1),
      call("MANAGE:SOCIAL", "MANAGE:SOCIAL", 2),
      call("READ", "DELEGATE", 1),
      call("READ", null, 2),
    ]);
    expect(summary).toMatchObject({
      calls: 4,
      failed: 1,
      right: 1,
      underActs: 1,
      overActs: 1,
      lostToThreshold: 1,
      flipped: 1,
    });
    expect(summary.confusion.MANAGE).toEqual({ READ: 1, MANAGE: 1 });
    expect(summary.confusion.READ).toEqual({ DELEGATE: 1, FAILED: 1 });
  });
});

describe("the dev set", () => {
  it("parses, with unique ids", () => {
    const cases = parseRoutingCases(
      JSON.parse(
        readFileSync(
          new URL(
            "../../../scripts/fixtures/jev-routing-set.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
    expect(cases.length).toBeGreaterThanOrEqual(140);
  });
});
