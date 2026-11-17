import { describe, expect, it } from "vitest";

import { scoreStudioAd } from "./ad-score";

describe("studio ad ranking", () => {
  it("starts neutral and shrinks a single thumb toward the prior", () => {
    expect(scoreStudioAd({ thumbsUp: 0, thumbsDown: 0, events: [] })).toBe(0.5);
    expect(
      scoreStudioAd({ thumbsUp: 1, thumbsDown: 0, events: [] }),
    ).toBeCloseTo(2 / 3);
    expect(
      scoreStudioAd({ thumbsUp: 0, thumbsDown: 1, events: [] }),
    ).toBeCloseTo(1 / 3);
  });

  it("ranks a positive thumb over a view, and a view over a hidden asset", () => {
    const score = (type: string) =>
      scoreStudioAd({
        thumbsUp: 0,
        thumbsDown: 0,
        events: [{ type, count: 1 }],
      });
    expect(
      scoreStudioAd({ thumbsUp: 1, thumbsDown: 0, events: [] }),
    ).toBeGreaterThan(score("viewed_lightbox"));
    expect(score("viewed_lightbox")).toBeGreaterThan(score("hidden"));
    expect(score("downloaded")).toBeGreaterThan(score("refined"));
    expect(score("replaced_in_batch")).toBeLessThan(0.5);
  });

  it("ignores unknown events and supports future judge and pairwise inputs", () => {
    expect(
      scoreStudioAd({
        thumbsUp: 0,
        thumbsDown: 0,
        events: [{ type: "unknown", count: 100 }],
      }),
    ).toBe(0.5);
    expect(
      scoreStudioAd({
        thumbsUp: 0,
        thumbsDown: 0,
        events: [],
        judgePrior: 0.8,
      }),
    ).toBe(0.8);
    expect(
      scoreStudioAd({
        thumbsUp: 0,
        thumbsDown: 0,
        events: [],
        pairwise: { score: 1, count: 2 },
      }),
    ).toBe(0.75);
  });
});
