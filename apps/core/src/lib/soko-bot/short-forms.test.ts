import { describe, expect, it } from "vitest";
import { fullToolRoundAllowed } from "./short-forms";

const shortCall = [{ toolCalls: [{ toolName: "save_strategy" }] }];
const room = {
  steps: shortCall,
  shortForms: ["save_strategy"] as const,
  stepsLeft: 3,
  tokensLeft: 1,
  timeUp: false,
};

describe("fullToolRoundAllowed", () => {
  it("gives a short-form call its full tool while every budget has room", () => {
    expect(fullToolRoundAllowed(room)).toBe(true);
  });

  it("gives it no round when any budget ran out on that call", () => {
    expect(fullToolRoundAllowed({ ...room, stepsLeft: 0 })).toBe(false);
    expect(fullToolRoundAllowed({ ...room, tokensLeft: 0 })).toBe(false);
    expect(fullToolRoundAllowed({ ...room, timeUp: true })).toBe(false);
  });

  it("gives no round to a round without a short-form call", () => {
    expect(
      fullToolRoundAllowed({
        ...room,
        steps: [{ toolCalls: [{ toolName: "read_calendar" }] }],
      }),
    ).toBe(false);
    expect(fullToolRoundAllowed({ ...room, shortForms: [] })).toBe(false);
  });
});
