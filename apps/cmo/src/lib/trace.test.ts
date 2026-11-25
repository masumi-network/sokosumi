import { describe, expect, it } from "vitest";
import { traceOf } from "./trace";

describe("traceOf", () => {
  it("splits Core's Thought into steps and reasoning", () => {
    expect(
      traceOf({
        reasoning: [
          {
            type: "reasoning",
            text: "**Picking a look**\n\nCalm, few colours.",
          },
          { type: "reasoning", text: "Reading your posts", kind: "step" },
          { type: "reasoning", text: "Reading your posts", kind: "step" },
          { type: "reasoning", text: "Changing a post", kind: "step" },
        ],
      }),
    ).toEqual({
      steps: ["Reading your posts", "Changing a post"],
      thoughts: ["**Picking a look**\n\nCalm, few colours."],
    });
  });

  it("shows nothing for a reply with only Core's own note, or none", () => {
    expect(
      traceOf({
        reasoning: [
          { type: "reasoning", text: "Answered directly.", kind: "note" },
        ],
      }),
    ).toBeNull();
    expect(traceOf(null)).toBeNull();
    expect(traceOf({ reasoning: "no" })).toBeNull();
    expect(
      traceOf({ reasoning: [{ text: 4 }, null, { text: "  " }] }),
    ).toBeNull();
  });
});
