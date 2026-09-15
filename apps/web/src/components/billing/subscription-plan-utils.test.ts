import { describe, expect, it } from "vitest";

import { getPlanTranslationKey } from "@/components/billing/subscription-plan-utils";

describe("subscription-plan-utils", () => {
  it("returns translation keys for subscription plans", () => {
    expect(getPlanTranslationKey("starter")).toBe("starter");
    expect(getPlanTranslationKey("pro")).toBe("pro");
    expect(getPlanTranslationKey("enterprise")).toBe("enterprise");
  });
});
