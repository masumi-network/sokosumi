import { describe, expect, it } from "vitest";

import { cmoBilling, cmoOverview } from "../test-fixtures/cmo";
import { readSkippedSteps, withSkippedSteps } from "./skipped-steps";

describe("withSkippedSteps", () => {
  it("keeps Core's step without the cookie", () => {
    for (const step of [
      "brandBrain",
      "strategy",
      "accounts",
      "checkout",
    ] as const) {
      const overview = cmoOverview({ onboardingStep: step });
      expect(withSkippedSteps(overview, readSkippedSteps(undefined))).toBe(
        overview,
      );
    }
  });

  it("owes the checkout once the person skipped the accounts", () => {
    expect(
      withSkippedSteps(
        cmoOverview({ onboardingStep: "accounts" }),
        readSkippedSteps("accounts"),
      ).onboardingStep,
    ).toBe("checkout");
  });

  it("is done after skipped accounts for a Cuso with Tester credits", () => {
    expect(
      withSkippedSteps(
        cmoOverview({
          onboardingStep: "accounts",
          billing: cmoBilling({ hasTesterCredits: true }),
        }),
        readSkippedSteps("accounts"),
      ).onboardingStep,
    ).toBe("done");
  });

  it("is done after skipped accounts once the Cuso has a CMO subscription", () => {
    expect(
      withSkippedSteps(
        cmoOverview({
          onboardingStep: "accounts",
          billing: cmoBilling({ status: "active" }),
        }),
        readSkippedSteps("accounts"),
      ).onboardingStep,
    ).toBe("done");
  });

  it("never skips the checkout", () => {
    const overview = cmoOverview({ onboardingStep: "checkout" });
    expect(withSkippedSteps(overview, readSkippedSteps("accounts"))).toBe(
      overview,
    );
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

  it("round-trips skipped questions and leaves Core's step alone", () => {
    const skipped = readSkippedSteps("questions,accounts");
    expect(skipped).toEqual(["questions", "accounts"]);
    const overview = cmoOverview({ onboardingStep: "brandBrain" });
    expect(withSkippedSteps(overview, readSkippedSteps("questions"))).toBe(
      overview,
    );
  });
});
