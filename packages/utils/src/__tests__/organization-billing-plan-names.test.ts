import { describe, expect, it } from "vitest";

import {
  PERSONAL_ASSISTANT_PLANS,
  parseOrganizationBillingPlanName,
  parseSelfServeSubscriptionPlanName,
  planUnlocksPersonalAssistant,
} from "../organization-billing-plan-names";

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

describe("parseOrganizationBillingPlanName", () => {
  it("accepts enterprise alongside the self-serve names", () => {
    expect(parseOrganizationBillingPlanName("enterprise")).toBe("enterprise");
    expect(parseOrganizationBillingPlanName("Standard")).toBe("standard");
  });

  it("rejects unknown values", () => {
    expect(parseOrganizationBillingPlanName("custom")).toBeNull();
    expect(parseOrganizationBillingPlanName("")).toBeNull();
    expect(parseOrganizationBillingPlanName(undefined)).toBeNull();
  });
});

describe("planUnlocksPersonalAssistant", () => {
  it("unlocks from Standard upwards", () => {
    expect(planUnlocksPersonalAssistant("standard")).toBe(true);
    expect(planUnlocksPersonalAssistant("pro")).toBe(true);
    expect(planUnlocksPersonalAssistant("enterprise")).toBe(true);
  });

  it("keeps free and starter out", () => {
    expect(planUnlocksPersonalAssistant("free")).toBe(false);
    expect(planUnlocksPersonalAssistant("starter")).toBe(false);
  });

  it("treats missing or unrecognized plans as locked", () => {
    expect(planUnlocksPersonalAssistant(null)).toBe(false);
    expect(planUnlocksPersonalAssistant(undefined)).toBe(false);
    expect(planUnlocksPersonalAssistant("custom")).toBe(false);
  });

  it("offers exactly the self-serve plans that pass the gate", () => {
    expect(PERSONAL_ASSISTANT_PLANS).toEqual(["standard", "pro"]);
    for (const plan of PERSONAL_ASSISTANT_PLANS) {
      expect(planUnlocksPersonalAssistant(plan)).toBe(true);
    }
  });
});
