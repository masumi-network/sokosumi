import { describe, expect, it } from "vitest";
import {
  type JudgeCall,
  type RouterCall,
  summarizeJudgeRun,
  summarizeRouterRun,
} from "./model-evaluation";

const call = (
  model: string,
  caseId: string,
  verdict: JudgeCall["verdict"],
): JudgeCall => ({ model, caseId, verdict, costUsd: 0.1, ms: 1_000 });

describe("summarizeJudgeRun", () => {
  const cases = [
    { caseId: "good", grade: "pass" as const, set: "lab" as const },
    { caseId: "sloppy", grade: "weak" as const, set: "lab" as const },
    { caseId: "broken", grade: "fail" as const, set: "known-bad" as const },
    { caseId: "unclear", grade: "uncertain" as const, set: "lab" as const },
  ];

  it("scores each model against the grades by its majority verdict", () => {
    const { models } = summarizeJudgeRun(
      [
        call("steady", "good", "pass"),
        call("steady", "good", "pass"),
        call("steady", "sloppy", "weak"),
        call("steady", "broken", "fail"),
        call("steady", "unclear", "pass"),
        call("harsh", "good", "fail"),
        call("harsh", "good", "pass"),
        call("harsh", "sloppy", "pass"),
        call("harsh", "broken", null),
      ],
      cases,
    );
    expect(models.find((m) => m.model === "steady")).toMatchObject({
      steady: 1,
      repeated: 1,
      // The uncertain case is run but never scored.
      matches: 3,
      graded: 3,
      falseFails: 0,
      badCaught: 1,
      bad: 1,
      errors: 0,
    });
    expect(models.find((m) => m.model === "harsh")).toMatchObject({
      steady: 0,
      repeated: 1,
      falseFails: 1,
      // An errored call is no verdict, so the known-bad turn is not caught.
      badCaught: 0,
      bad: 0,
      errors: 1,
    });
  });

  it("marks a case contested when a model's majority misses the grade", () => {
    const { cases: summary } = summarizeJudgeRun(
      [call("a", "good", "pass"), call("b", "good", "weak")],
      cases.slice(0, 1),
    );
    expect(summary[0]).toMatchObject({
      contested: true,
      answers: { a: ["pass"], b: ["weak"] },
    });
  });
});

describe("summarizeRouterRun", () => {
  const cases = [
    { message: "what's new?", want: "READ" },
    { message: "post it in chat", want: "MANAGE:CHAT" },
    { message: "assign it to Alex", want: "DELEGATE", alt: ["MANAGE:WORK"] },
  ];
  const route = (
    classifier: string,
    caseIndex: number,
    outcome: string | null,
    ms = 500,
  ): RouterCall => ({ classifier, caseIndex, outcome, costUsd: 0.001, ms });

  it("counts both directions of a wrong grant separately", () => {
    const { models } = summarizeRouterRun(
      [
        route("jev", 0, "MANAGE:CHAT"),
        route("jev", 1, "READ"),
        route("jev", 2, "MANAGE:WORK"),
      ],
      cases,
    );
    expect(models[0]).toMatchObject({
      correct: 1,
      overGrants: 1,
      underGrants: 1,
      costPer1kUsd: 1,
    });
  });

  it("calls a case steady only when every run agrees", () => {
    const { models, cases: summary } = summarizeRouterRun(
      [
        route("jev", 1, "MANAGE:CHAT"),
        route("jev", 1, "READ"),
        route("jev", 0, "READ"),
        route("jev", 0, "READ"),
        route("jev", 2, null),
      ],
      cases,
    );
    expect(models[0]).toMatchObject({ steady: 1, alwaysRight: 1, errors: 1 });
    expect(summary.map((c) => c.contested)).toEqual([false, true, true]);
  });
});
