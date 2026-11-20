import { describe, expect, it } from "vitest";

import { coworkerFirstPrompts } from "./coworker-first-prompts";

describe("coworkerFirstPrompts", () => {
  it("offers the coworker's own example prompts first", () => {
    expect(
      coworkerFirstPrompts({
        profile: { examples: ["Plan a campaign", "Write a launch post"] },
        offers: [{ title: "Competitive analysis", prompt: "Run an analysis" }],
      }),
    ).toEqual([
      { label: "Plan a campaign", text: "Plan a campaign" },
      { label: "Write a launch post", text: "Write a launch post" },
      { label: "Competitive analysis", text: "Run an analysis" },
    ]);
  });

  it("keeps at most three and skips blanks and repeats", () => {
    expect(
      coworkerFirstPrompts({
        profile: { examples: [" A ", "", "A", "B"] },
        offers: [
          { title: "C", prompt: "c" },
          { title: "D", prompt: "d" },
        ],
      }).map((prompt) => prompt.text),
    ).toEqual(["A", "B", "c"]);
  });

  it("offers nothing when the coworker has no examples or offers", () => {
    expect(coworkerFirstPrompts(undefined)).toEqual([]);
    expect(coworkerFirstPrompts({ profile: {} })).toEqual([]);
  });
});
