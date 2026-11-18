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
