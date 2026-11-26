import { describe, expect, it } from "vitest";

import {
  monthGivenUp,
  planningLine,
  productionShare,
  productionSteps,
  retryWhen,
  stoppedNote,
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
  writerFailed: false,
  floor: null,
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

describe("stoppedNote", () => {
  const stuck = { ...production, state: "stuck" as const, written: 4 };
  const at = new Date(Date.now() + 60_000).toISOString();

  it("says a month Core gave up on is not tried again, and never 'soon'", () => {
    const given = { ...stuck, writerFailed: true, retryAt: null };
    expect(monthGivenUp(given)).toBe(true);
    expect(stoppedNote(given, 10, "UTC")).toBe(
      "He couldn't finish this month's posts. Our team has been told, and he won't try again on his own.",
    );
  });

  it("keeps the retry time for a month that runs again", () => {
    const ours = { ...stuck, writerFailed: true, retryAt: at };
    expect(monthGivenUp(ours)).toBe(false);
    expect(stoppedNote(ours, 10, "UTC")).toMatch(
      /^Words 4 of 10 · Pictures 0 of 6\. Something on our side stopped him\. We're fixing it, and he tries again (tomorrow )?at \d\d:\d\d\.$/,
    );
    expect(stoppedNote({ ...stuck, retryAt: at }, 10, "UTC")).toMatch(
      /His last try made nothing new, so he tries the rest again (tomorrow )?at \d\d:\d\d\.$/,
    );
  });

  it("is only for a stopped month", () => {
    expect(
      monthGivenUp({ ...production, writerFailed: true, retryAt: null }),
    ).toBe(false);
  });
});

describe("planningLine", () => {
  it("names the plan's minimum while Core plans the month, and nothing after", () => {
    expect(
      planningLine({
        ...production,
        state: "planning",
        floor: { promised: 1204, made: 0 },
      }),
    ).toBe("At least 1,204 posts are being planned.");
    expect(planningLine({ ...production, state: "planning" })).toBe(
      "Your month is being planned.",
    );
    expect(planningLine(production)).toBeNull();
  });
});
