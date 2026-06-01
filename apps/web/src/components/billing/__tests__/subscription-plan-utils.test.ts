import { describe, expect, it } from "vitest";

import {
  getPlanTranslationKey,
  parsePlanName,
} from "@/components/billing/subscription-plan-utils";

describe("subscription-plan-utils", () => {
  it("parses self-serve and enterprise plan names", () => {
    expect(parsePlanName("starter")).toBe("starter");
    expect(parsePlanName("Pro")).toBe("pro");
    expect(parsePlanName("enterprise")).toBe("enterprise");
    expect(parsePlanName("Enterprise")).toBe("enterprise");
  });

  it("returns translation keys for subscription plans", () => {
    expect(getPlanTranslationKey("starter")).toBe("starter");
    expect(getPlanTranslationKey("pro")).toBe("pro");
    expect(getPlanTranslationKey("enterprise")).toBe("enterprise");
  });
});
