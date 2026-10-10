import { describe, expect, it } from "vitest";
import {
  facebookInsightShareCount,
  facebookShareCount,
} from "@/clients/social-post-providers/facebook-shares";

const insightShares = {
  data: [
    {
      name: "post_activity_by_action_type",
      total_value: { value: { share: 6 } },
    },
  ],
};

describe("facebook share counts", () => {
  it("reads insight shares from the action-type breakdown", () => {
    expect(facebookInsightShareCount(insightShares)).toBe(6);
  });

  it("prefers Insights over a Graph shares.count of zero", () => {
    expect(facebookShareCount(0, insightShares)).toBe(6);
  });

  it("treats a Graph zero as unknown when Insights omit shares", () => {
    expect(facebookShareCount(0, { data: [] })).toBeNull();
    expect(facebookShareCount(0, null)).toBeNull();
  });

  it("keeps a measured Graph share count when Insights are missing", () => {
    expect(facebookShareCount(2, null)).toBe(2);
  });
});
