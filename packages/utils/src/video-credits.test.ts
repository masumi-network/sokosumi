import { describe, expect, it } from "vitest";

import { creditsPerVideoCents } from "./video-credits";

const price = { perSecondUsd: { "480P": 0.025, "768P": 0.04 } };

describe("creditsPerVideoCents", () => {
  it("multiplies the verified per-second price by the length and rounds up", () => {
    expect(
      creditsPerVideoCents(price, { resolution: "768P", durationSeconds: 5 }),
    ).toBe(20);
    expect(
      creditsPerVideoCents(price, { resolution: "480P", durationSeconds: 15 }),
    ).toBe(38);
  });

  it("refuses a resolution nobody verified a price for", () => {
    expect(
      creditsPerVideoCents(price, { resolution: "1080P", durationSeconds: 5 }),
    ).toBeNull();
    expect(
      creditsPerVideoCents({}, { resolution: "768P", durationSeconds: 5 }),
    ).toBeNull();
  });

  it("refuses a negative price or a missing length", () => {
    expect(
      creditsPerVideoCents(
        { perSecondUsd: { "768P": -1 } },
        { resolution: "768P", durationSeconds: 5 },
      ),
    ).toBeNull();
    expect(
      creditsPerVideoCents(price, { resolution: "768P", durationSeconds: 0 }),
    ).toBeNull();
  });
});
