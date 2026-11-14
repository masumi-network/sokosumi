import { describe, expect, it } from "vitest";
import { SEO_CAPABILITIES } from "./seo-capabilities";

describe("SEO_CAPABILITIES", () => {
  it("keeps the doc's 45 item numbers, once each and in order", () => {
    expect(SEO_CAPABILITIES.map((item) => item.id)).toEqual(
      Array.from({ length: 45 }, (_, index) => index + 1),
    );
  });

  it("says what is missing and what unlocks it for every item not built", () => {
    for (const item of SEO_CAPABILITIES)
      if (item.status === "built")
        expect(item.missing, `item ${item.id}`).toBeNull();
      else {
        expect(item.missing, `item ${item.id}`).toBeTruthy();
        expect(item.unlocks.length, `item ${item.id}`).toBeGreaterThan(0);
      }
  });
});
