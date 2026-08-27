import { describe, expect, it } from "vitest";

import { parseSelfServeSubscriptionPlanName } from "./organization-billing-plan-names";

describe("parseSelfServeSubscriptionPlanName", () => {
  it("parses self-serve plan names case-insensitively", () => {
    expect(parseSelfServeSubscriptionPlanName("starter")).toBe("starter");
    expect(parseSelfServeSubscriptionPlanName("PRO")).toBe("pro");
    expect(parseSelfServeSubscriptionPlanName("free")).toBe("free");
  });

  it("rejects enterprise and unknown values", () => {
    expect(parseSelfServeSubscriptionPlanName("enterprise")).toBeNull();
    expect(parseSelfServeSubscriptionPlanName(null)).toBeNull();
    expect(parseSelfServeSubscriptionPlanName("custom")).toBeNull();
  });
});
