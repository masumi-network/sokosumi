import { describe, expect, it } from "vitest";

import { cmoOverview } from "../test-fixtures/cmo";
import { readSkippedSteps, withSkippedSteps } from "./skipped-steps";

describe("withSkippedSteps", () => {
  it("keeps Core's step without the cookie", () => {
    for (const step of [
      "brandBrain",
      "strategy",
      "accounts",
      "plan",
    ] as const) {
      const overview = cmoOverview({ onboardingStep: step });
      expect(withSkippedSteps(overview, readSkippedSteps(undefined))).toBe(
        overview,
      );
    }
  });

  it("moves past the accounts the person skipped", () => {
    const skipped = readSkippedSteps("accounts");
    expect(
      withSkippedSteps(cmoOverview({ onboardingStep: "accounts" }), skipped)
        .onboardingStep,
    ).toBe("plan");
    expect(
      withSkippedSteps(cmoOverview({ onboardingStep: "plan" }), skipped)
        .onboardingStep,
    ).toBe("plan");
  });

  it("is done once the person chose to subscribe later", () => {
    const skipped = readSkippedSteps("accounts,plan");
    expect(
      withSkippedSteps(cmoOverview({ onboardingStep: "plan" }), skipped)
        .onboardingStep,
    ).toBe("done");
    // Subscribe later is offered where no account is needed, too.
    expect(
      withSkippedSteps(
        cmoOverview({ onboardingStep: "accounts" }),
        readSkippedSteps("plan"),
      ).onboardingStep,
    ).toBe("done");
  });

  it("still waits for the Brand Brain and an approved strategy", () => {
    const skipped = readSkippedSteps("accounts,plan");
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
    expect(readSkippedSteps("brandBrain,,plan")).toEqual(["plan"]);
  });
});
