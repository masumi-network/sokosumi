import { describe, expect, it } from "vitest";

import {
  getPlanTranslationKey,
  parsePlanName,
} from "@/components/billing/subscription-plan-utils";

describe("subscription-plan-utils", () => {
  it("parses Enterprise plan names", () => {
    expect(parsePlanName("enterprise")).toBe("enterprise");
    expect(parsePlanName("Enterprise")).toBe("enterprise");
  });

  it("returns the Enterprise translation key", () => {
    expect(getPlanTranslationKey("enterprise")).toBe("enterprise");
  });
});
