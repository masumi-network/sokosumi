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

  it("cuts a long result so the match comes within the first words", () => {
    const excerpt = resultMatchExcerpt(
      "Acme charges 49 a month for Starter and 99 for Team. Their annual discount is 20%, so a yearly Team plan costs 950. Our Team plan is cheaper per month but has no yearly offer yet, and nobody asked for one so far this year.",
      "annual discount",
    );

    expect(excerpt).toBe(
      "…99 for Team. Their annual discount is 20%, so a yearly Team plan costs 950. Our Team plan is cheaper per month but has no yearly offer yet, and nobody asked for…",
    );
    // Card shows two lines, a list row one: the match leads.
    expect(excerpt.indexOf("annual discount")).toBeLessThan(24);
  });

  it("cuts into a long word rather than push the match back", () => {
    const excerpt = resultMatchExcerpt(`${"x".repeat(100)} pricing`, "pricing");

    expect(excerpt).toBe(`…${"x".repeat(19)} pricing`);
  });

  it("keeps a match that sits in a link target in view", () => {
    expect(
      resultMatchExcerpt(
        "See [the deck](https://slides.test/pricing).",
        "pricing",
      ),
    ).toBe("…deck](https://slides.test/pricing).");
  });

  it("keeps a match inside a fenced code block in view", () => {
    expect(
      resultMatchExcerpt("```\nSKU-4471 ships Friday\n```", "sku-4471"),
    ).toBe("``` SKU-4471 ships Friday ```");
  });
});
