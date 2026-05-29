import { describe, expect, it } from "vitest";

import {
  getPlanTranslationKey,
  parsePlanName,
} from "@/components/billing/subscription-plan-utils";

describe("subscription-plan-utils", () => {
  it("parses self-serve plan names", () => {
    expect(parsePlanName("starter")).toBe("starter");
    expect(parsePlanName("Pro")).toBe("pro");
    expect(parsePlanName("enterprise")).toBeNull();
  });

  it("returns translation keys for self-serve plans", () => {
    expect(getPlanTranslationKey("starter")).toBe("starter");
    expect(getPlanTranslationKey("pro")).toBe("pro");
  });
});
