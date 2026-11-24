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

  it("keeps a match that sits in a link target in view", () => {
    expect(
      resultMatchExcerpt(
        "See [the deck](https://slides.test/pricing).",
        "pricing",
      ),
    ).toBe("See [the deck](https://slides.test/pricing).");
  });

  it("keeps a match inside a fenced code block in view", () => {
    expect(
      resultMatchExcerpt("```\nSKU-4471 ships Friday\n```", "sku-4471"),
    ).toBe("``` SKU-4471 ships Friday ```");
  });
});
