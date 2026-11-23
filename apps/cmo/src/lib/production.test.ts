import { describe, expect, it } from "vitest";

import {
  productionShare,
  productionSteps,
  retryWhen,
  withoutPictureLine,
} from "./production";

const production = {
  state: "running" as const,
  ready: 0,
  total: 10,
  written: 0,
  pictured: 0,
  needPictures: 6,
  finishedAt: null,
  pillars: null,
  level: "all_in" as const,
  beyondPlan: [],
  withoutPicture: [],
  retryAt: null,
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

  it("says when a stopped month is tried again, in the owner's time zone", () => {
    const now = new Date("2026-11-23T02:00:00Z");
    expect(retryWhen("2026-11-23T05:16:00Z", "Europe/Zurich", now)).toBe(
      "at 06:16",
    );
    expect(retryWhen("2026-11-23T09:00:00Z", "America/Los_Angeles", now)).toBe(
      "tomorrow at 01:00",
    );
    expect(retryWhen(null, "Europe/Zurich", now)).toBe("soon");
  });

  it("names the posts whose picture never fit the brand", () => {
    expect(withoutPictureLine(production)).toBeNull();
    expect(withoutPictureLine({ ...production, withoutPicture: ["a"] })).toBe(
      "1 post has no picture: none he made fit your brand, so it stays a draft.",
    );
  });
});
