import { describe, expect, it } from "vitest";

import { elapsedLabel, workChecklist } from "./checklist";

const PHASES = [
  { kinds: ["other"], label: "Your channels" },
  { kinds: ["strategy"], label: "Four weeks, day by day" },
] as const;

type Step = Parameters<typeof workChecklist>[0][number];

const step = (kind: Step["kind"], status: Step["status"]): Step =>
  ({ kind, status, id: kind, label: kind, url: null, at: new Date(0) }) as Step;

const states = (steps: Step[], running: boolean) =>
  workChecklist(steps, PHASES, running).map((item) => item.state);

describe("workChecklist", () => {
  it("shows the first phase working as soon as the work runs, before Core reports a step", () => {
    expect(states([], true)).toEqual(["working", "next"]);
  });

  it("moves on to the next phase once the first is done and nothing has started yet", () => {
    expect(states([step("other", "done")], true)).toEqual(["done", "working"]);
  });

  it("keeps everything next while nothing runs", () => {
    expect(states([], false)).toEqual(["next", "next"]);
  });

  it("follows a running step when Core reports one", () => {
    expect(states([step("strategy", "running")], true)).toEqual([
      "done",
      "working",
    ]);
  });
});

describe("elapsedLabel", () => {
  it("counts seconds, then minutes, then hours", () => {
    expect(elapsedLabel(12)).toBe("12s so far");
    expect(elapsedLabel(4 * 60 + 5)).toBe("4 min so far");
    expect(elapsedLabel(2 * 3600 + 120)).toBe("2 h so far");
  });
});
