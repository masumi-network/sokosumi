import { describe, expect, it, vi } from "vitest";

import type { AskCompetitorModel } from "./model";
import {
  type PageChangeVerdict,
  priceMoveSummary,
  readPageChange,
} from "./page-change";

function model(verdict: PageChangeVerdict) {
  const calls: string[] = [];
  const ask: AskCompetitorModel = async ({ prompt, schema }) => {
    calls.push(prompt);
    return { output: schema.parse(verdict), costUsd: 0.0004 };
  };
  return { ask, calls };
}

const failing: AskCompetitorModel = vi.fn(async () => {
  throw new Error("gateway down");
});

const page = [
  "Plans",
  "Free plan: 1 calendar",
  "Standard",
  "$12",
  "Now with AI notetaker",
];
const diff = {
  added: ["Free plan: 1 calendar", "Now with AI notetaker"],
  removed: ["Free plan: 3 calendars"],
};
const input = {
  competitor: "Calendly",
  page: "pricing page" as const,
  diff,
  lines: page,
  prices: null,
};

describe("readPageChange", () => {
  it("returns the model's line with a quote from the page", async () => {
    const { ask, calls } = model({
      real: true,
      summary: "Free plan now limited to 1 calendar, was 3",
      quote: "Free plan: 1 calendar",
      about: "pricing",
    });
    expect(await readPageChange(input, ask)).toEqual({
      change: {
        summary: "Free plan now limited to 1 calendar, was 3",
        quote: "Free plan: 1 calendar",
        about: "pricing",
      },
      costUsd: 0.0004,
    });
    expect(JSON.parse(calls[0] ?? "{}")).toEqual({
      company: "Calendly",
      page: "pricing page",
      added: [
        { line: "Free plan: 1 calendar", above: ["Plans"] },
        { line: "Now with AI notetaker", above: ["Standard", "$12"] },
      ],
      removed: diff.removed,
    });
  });

  it("replaces a quote the page never said with the first new line", async () => {
    const { ask } = model({
      real: true,
      summary: "Free plan cut",
      quote: "Calendly slashes its free plan",
      about: "pricing",
    });
    const result = await readPageChange(input, ask);
    expect(result.change?.quote).toBe("Free plan: 1 calendar");
  });

  it("finds no change when the model calls it noise", async () => {
    const { ask } = model({
      real: false,
      summary: "",
      quote: "",
      about: "other",
    });
    expect(await readPageChange(input, ask)).toEqual({
      change: null,
      costUsd: 0.0004,
    });
  });

  it("finds no change when the model gives no line", async () => {
    const { ask } = model({
      real: true,
      summary: "  ",
      quote: "",
      about: "other",
    });
    expect((await readPageChange(input, ask)).change).toBeNull();
  });

  it("asks nobody when nothing changed", async () => {
    const { ask, calls } = model({
      real: true,
      summary: "x",
      quote: "",
      about: "other",
    });
    expect(
      await readPageChange({ ...input, diff: { added: [], removed: [] } }, ask),
    ).toEqual({ change: null, costUsd: 0 });
    expect(calls).toHaveLength(0);
  });

  it("sends at most forty lines a side and clips a long line", async () => {
    const many = Array.from(
      { length: 90 },
      (_unused, index) => `Line ${index}`,
    );
    const { ask, calls } = model({
      real: true,
      summary: "x".repeat(300),
      quote: "Line 0",
      about: "product",
    });
    const result = await readPageChange(
      { ...input, diff: { added: many, removed: many } },
      ask,
    );
    const prompt = JSON.parse(calls[0] ?? "{}");
    expect(prompt.added).toHaveLength(40);
    expect(prompt.removed).toHaveLength(40);
    expect(result.change?.summary).toHaveLength(140);
  });

  it("throws when the model fails and no price moved", async () => {
    await expect(readPageChange(input, failing)).rejects.toThrow(
      "gateway down",
    );
  });

  describe("when the listed prices moved", () => {
    const priced = {
      ...input,
      diff: { added: ["$12"], removed: ["$10"] },
      prices: { before: ["$10"], after: ["$12"] },
    };

    it("tells the model and files it under pricing whatever it says", async () => {
      const { ask, calls } = model({
        real: true,
        summary: "Standard plan $10 -> $12",
        quote: "$12",
        about: "product",
      });
      expect((await readPageChange(priced, ask)).change).toEqual({
        summary: "Standard plan $10 -> $12",
        quote: "$12",
        about: "pricing",
      });
      const prompt = JSON.parse(calls[0] ?? "{}");
      expect(prompt.prices).toEqual({ before: ["$10"], after: ["$12"] });
      expect(prompt.added).toEqual([
        { line: "$12", above: ["Free plan: 1 calendar", "Standard"] },
      ]);
    });

    it("still reports the prices when the model calls it noise", async () => {
      const { ask } = model({
        real: false,
        summary: "",
        quote: "",
        about: "other",
      });
      expect((await readPageChange(priced, ask)).change).toEqual({
        summary: "Prices changed: $10 -> $12",
        quote: "$12",
        about: "pricing",
      });
    });

    it("still reports the prices when the model fails", async () => {
      expect(await readPageChange(priced, failing)).toEqual({
        change: {
          summary: "Prices changed: $10 -> $12",
          quote: "$12",
          about: "pricing",
        },
        costUsd: 0,
      });
    });
  });
});

describe("priceMoveSummary", () => {
  it("says what moved, was added or went", () => {
    expect(priceMoveSummary({ before: ["$10", "$16"], after: ["$12"] })).toBe(
      "Prices changed: $10, $16 -> $12",
    );
    expect(priceMoveSummary({ before: [], after: ["$30"] })).toBe(
      "New prices listed: $30",
    );
    expect(priceMoveSummary({ before: ["$30"], after: [] })).toBe(
      "Prices removed: $30",
    );
  });
});
