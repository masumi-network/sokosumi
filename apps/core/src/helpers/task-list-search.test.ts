import { describe, expect, it } from "vitest";
import { resultMatchExcerpt } from "./task-list-search";

describe("resultMatchExcerpt", () => {
  it("shows a short result whole, as plain text on one line", () => {
    expect(
      resultMatchExcerpt(
        "# Plan\n\nThe **launch** is [here](https://x.test).",
        "LAUNCH",
      ),
    ).toBe("Plan The launch is here.");
  });

  it("cuts a long result around the first match", () => {
    const before = "a".repeat(100);
    const after = "b".repeat(200);
    const excerpt = resultMatchExcerpt(`${before} pricing ${after}`, "pricing");

    expect(excerpt).toBe(`…${"a".repeat(59)} pricing ${"b".repeat(92)}…`);
  });

  it("starts at the beginning when the match is in markup it removed", () => {
    expect(
      resultMatchExcerpt(
        "See [the deck](https://slides.test/pricing).",
        "pricing",
      ),
    ).toBe("See the deck.");
  });
});
