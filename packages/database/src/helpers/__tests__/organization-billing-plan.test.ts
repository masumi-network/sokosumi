import { describe, expect, it } from "vitest";

import { parseSelfServeSubscriptionPlanName } from "../organization-billing-plan.js";

describe("parseSelfServeSubscriptionPlanName", () => {
  it("parses self-serve plan names", () => {
    expect(parseSelfServeSubscriptionPlanName("starter")).toBe("starter");
    expect(parseSelfServeSubscriptionPlanName("PRO")).toBe("pro");
    expect(parseSelfServeSubscriptionPlanName("free")).toBe("free");
  });

  it("returns null for unknown values", () => {
    expect(parseSelfServeSubscriptionPlanName("enterprise")).toBeNull();
    expect(parseSelfServeSubscriptionPlanName(null)).toBeNull();
    expect(parseSelfServeSubscriptionPlanName("custom")).toBeNull();
  });
});
