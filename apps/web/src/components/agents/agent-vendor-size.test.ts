import { describe, expect, it } from "vitest";

import { logoHeight } from "./agent-vendor-size";

// Width / height of real author logos on prod marketplace agents.
const PROD_LOGOS = {
  attentionInsight: 230 / 96,
  macroBuilt: 868 / 263,
  nuauth: 394 / 94,
  nmkr: 523 / 94,
  planNet: 756 / 94,
};

describe("logoHeight", () => {
  it("gives wide wordmarks less height and compact logos more", () => {
    const heights = Object.values(PROD_LOGOS).map((r) => logoHeight(r, "sm"));
    expect(heights).toEqual([13, 11, 10, 9, 8]);
  });

  it("keeps every card logo inside the room before the button", () => {
    for (const ratio of [...Object.values(PROD_LOGOS), 1, 20]) {
      expect(logoHeight(ratio, "sm") * ratio).toBeLessThanOrEqual(96.5);
      expect(logoHeight(ratio, "sm")).toBeLessThanOrEqual(14);
    }
  });
});
