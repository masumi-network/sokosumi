import {
  resolveAppTopNotice,
  resolveLowCreditsBillingPath,
} from "@/app/components/top-notice-state";

describe("top-notice-state", () => {
  it("prioritizes email verification over the low-credits banner", () => {
    expect(
      resolveAppTopNotice({
        credits: 25,
        currentPlan: "starter",
        email: "user@example.com",
        emailVerified: false,
        threshold: 500,
      }),
    ).toEqual({
      email: "user@example.com",
      kind: "emailVerification",
    });
  });

  it("routes free users with low credits to the subscription tab", () => {
    expect(resolveLowCreditsBillingPath("free")).toBe(
      "/billing?tab=subscription",
    );
    expect(
      resolveAppTopNotice({
        credits: 25,
        currentPlan: "free",
        email: "user@example.com",
        emailVerified: true,
        threshold: 500,
      }),
    ).toEqual({
      kind: "lowCredits",
      path: "/billing?tab=subscription",
    });
  });

  it("routes free users with no credits to the subscription tab and uses the out-of-credits state", () => {
    expect(
      resolveAppTopNotice({
        credits: 0,
        currentPlan: "free",
        email: "user@example.com",
        emailVerified: true,
        threshold: 500,
      }),
    ).toEqual({
      kind: "outOfCredits",
      path: "/billing?tab=subscription",
    });
  });

  it("routes paid-plan users with low credits to the credits tab", () => {
    expect(resolveLowCreditsBillingPath("starter")).toBe(
      "/billing?tab=credits",
    );
    expect(
      resolveAppTopNotice({
        credits: 25,
        currentPlan: "starter",
        email: "user@example.com",
        emailVerified: true,
        threshold: 500,
      }),
    ).toEqual({
      kind: "lowCredits",
      path: "/billing?tab=credits",
    });
  });

  it("routes paid-plan users with no credits to the credits tab and uses the out-of-credits state", () => {
    expect(
      resolveAppTopNotice({
        credits: 0,
        currentPlan: "starter",
        email: "user@example.com",
        emailVerified: true,
        threshold: 500,
      }),
    ).toEqual({
      kind: "outOfCredits",
      path: "/billing?tab=credits",
    });
  });

  it("still shows the out-of-credits banner when the threshold is zero", () => {
    expect(
      resolveAppTopNotice({
        credits: 0,
        currentPlan: "starter",
        email: "user@example.com",
        emailVerified: true,
        threshold: 0,
      }),
    ).toEqual({
      kind: "outOfCredits",
      path: "/billing?tab=credits",
    });
  });

  it("does not show the low-credits banner above zero when the threshold is zero", () => {
    expect(
      resolveAppTopNotice({
        credits: 1,
        currentPlan: "starter",
        email: "user@example.com",
        emailVerified: true,
        threshold: 0,
      }),
    ).toEqual({
      kind: "none",
    });
  });

  it("does not show the low-credits banner when the balance equals the threshold", () => {
    expect(
      resolveAppTopNotice({
        credits: 500,
        currentPlan: "starter",
        email: "user@example.com",
        emailVerified: true,
        threshold: 500,
      }),
    ).toEqual({
      kind: "none",
    });
  });

  it("does not show the low-credits banner when credits are unavailable", () => {
    expect(
      resolveAppTopNotice({
        credits: null,
        currentPlan: "starter",
        email: "user@example.com",
        emailVerified: true,
        threshold: 500,
      }),
    ).toEqual({
      kind: "none",
    });
  });
});
