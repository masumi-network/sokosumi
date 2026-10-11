import { describe, expect, it } from "vitest";
import { strongSocialAccountPostIds } from "./social-account-post-strong";

const empty = {
  views: null,
  impressions: 100,
  likes: 0,
  comments: 0,
  shares: 0,
  saves: null,
};

function post(
  id: string,
  likes: number,
  extras: { impressions?: number; comments?: number } = {},
) {
  return {
    id,
    provider: "x" as const,
    metrics: {
      ...empty,
      impressions: extras.impressions ?? 100,
      likes,
      comments: extras.comments ?? 0,
    },
    additionalMetrics: [
      { key: "quote_count", value: 0, period: null, unit: null },
    ],
  };
}

describe("strongSocialAccountPostIds", () => {
  it("marks none when no post has measured interactions", () => {
    expect(
      strongSocialAccountPostIds([
        post("a", 0),
        {
          id: "b",
          provider: "x",
          metrics: { ...empty, likes: null, comments: 1, shares: 0 },
          additionalMetrics: [
            { key: "quote_count", value: 0, period: null, unit: null },
          ],
        },
      ]),
    ).toEqual(new Set());
  });

  it("marks the only measured post with interactions", () => {
    expect(strongSocialAccountPostIds([post("a", 4)])).toEqual(new Set(["a"]));
  });

  it("keeps the top quarter when rates differ", () => {
    expect(
      strongSocialAccountPostIds([
        post("a", 1),
        post("b", 2),
        post("c", 3),
        post("d", 4),
      ]),
    ).toEqual(new Set(["d"]));
  });

  it("keeps tied posts that share the cutoff rate", () => {
    expect(
      strongSocialAccountPostIds([
        post("a", 1),
        post("b", 4),
        post("c", 4),
        post("d", 4),
      ]),
    ).toEqual(new Set(["b", "c", "d"]));
  });
});
