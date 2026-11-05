import { describe, expect, it } from "vitest";

import { cmoOverview } from "../test-fixtures/cmo";
import { readSkippedSteps, withSkippedSteps } from "./skipped-steps";

describe("withSkippedSteps", () => {
  it("keeps Core's step without the cookie", () => {
    for (const step of ["brandBrain", "strategy", "accounts"] as const) {
      const overview = cmoOverview({ onboardingStep: step });
      expect(withSkippedSteps(overview, readSkippedSteps(undefined))).toBe(
        overview,
      );
    }
  });

  it("is done once the person skipped the accounts", () => {
    expect(
      withSkippedSteps(
        cmoOverview({ onboardingStep: "accounts" }),
        readSkippedSteps("accounts"),
      ).onboardingStep,
    ).toBe("done");
  });

  it("still waits for the Brand Brain and an approved strategy", () => {
    const skipped = readSkippedSteps("accounts");
    expect(
      withSkippedSteps(cmoOverview({ onboardingStep: "brandBrain" }), skipped)
        .onboardingStep,
    ).toBe("brandBrain");
    expect(
      withSkippedSteps(cmoOverview({ onboardingStep: "strategy" }), skipped)
        .onboardingStep,
    ).toBe("strategy");
  });

  it("ignores what it does not know in the cookie", () => {
    expect(readSkippedSteps("brandBrain,,plan,accounts")).toEqual(["accounts"]);
  });
});
