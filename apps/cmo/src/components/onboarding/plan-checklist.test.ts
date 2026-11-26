import { expect, it } from "vitest";

import { strategy } from "../../test-fixtures/onboarding";
import { planningChecklist } from "./plan-step";

const states = (items: { state: string }[]) => items.map((item) => item.state);

it("is on the channels until the plan's idea and channels are saved", () => {
  expect(states(planningChecklist([], null, true))).toEqual([
    "working",
    "next",
  ]);
});

it("is on the calendar once the plan's channels are saved, like the feed", () => {
  expect(states(planningChecklist([], strategy, true))).toEqual([
    "done",
    "working",
  ]);
});

it("names the example posts once a cmo-v22 plan is saved", () => {
  const items = planningChecklist(
    [],
    { ...strategy, monthWriter: { state: "examples", attempts: 0 } },
    true,
  );
  expect(items.map((item) => item.label)).toEqual([
    "Your channels",
    "A few example posts",
  ]);
  expect(states(planningChecklist([], strategy, true))).toEqual([
    "done",
    "working",
  ]);
  expect(planningChecklist([], strategy, true)[1]?.label).toBe(
    "Four weeks, day by day",
  );
});
