import { describe, expect, it } from "vitest";

import { productionShare, productionSteps } from "./production";

const production = {
  state: "running" as const,
  ready: 0,
  total: 10,
  written: 0,
  pictured: 0,
  needPictures: 6,
  finishedAt: null,
  pillars: null,
};

describe("production progress", () => {
  it("moves while Cuso writes, before any piece is finished", () => {
    expect(productionShare(production)).toBe(0);
    expect(productionShare({ ...production, written: 5 })).toBe(19);
    expect(
      productionShare({ ...production, written: 10, pictured: 6, ready: 10 }),
    ).toBe(100);
    expect(productionShare({ ...production, state: "ready" })).toBe(100);
  });

  it("names both passes, and words alone when nothing needs a picture", () => {
    expect(productionSteps({ ...production, written: 4, pictured: 1 })).toBe(
      "Words 4 of 10 · Pictures 1 of 6",
    );
    expect(productionSteps({ ...production, needPictures: 0 })).toBe(
      "Words 0 of 10",
    );
  });
});
