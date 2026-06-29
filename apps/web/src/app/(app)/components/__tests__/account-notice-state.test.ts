import { describe, expect, it } from "vitest";
import {
  resolveAccountNotice,
  resolveLowCreditsBillingPath,
} from "@/app/components/account-notice-state";

describe("account-notice-state", () => {
  it("prioritizes email verification over the low-credits notice", () => {
    expect(
      resolveAccountNotice({
        credits: 25,
        currentPlan: "starter",
        email: "user@example.com",
        emailVerified: false,
        threshold: 500,
      }),
    ).toEqual({
      email: "user@example.com",
      tone: "warning",
      type: "emailVerification",
    });
  });

  it("routes free users with low credits to the subscription tab", () => {
    expect(resolveLowCreditsBillingPath("free")).toBe(
      "/billing?tab=subscription",
    );
    expect(
      resolveAccountNotice({
        credits: 25,
        currentPlan: "free",
        email: "user@example.com",
        emailVerified: true,
        threshold: 500,
      }),
    ).toEqual({
      path: "/billing?tab=subscription",
      tone: "warning",
      type: "lowCredits",
    });
  });

  it("routes free users with no credits to the subscription tab and uses the out-of-credits state", () => {
    expect(
      resolveAccountNotice({
        credits: 0,
        currentPlan: "free",
        email: "user@example.com",
        emailVerified: true,
        threshold: 500,
      }),
    ).toEqual({
      path: "/billing?tab=subscription",
      tone: "destructive",
      type: "outOfCredits",
    });
  });

  it("routes paid-plan users with low credits to the credits tab", () => {
    expect(resolveLowCreditsBillingPath("starter")).toBe(
      "/billing?tab=credits",
    );
    expect(
      resolveAccountNotice({
        credits: 25,
        currentPlan: "starter",
        email: "user@example.com",
        emailVerified: true,
        threshold: 500,
      }),
    ).toEqual({
      path: "/billing?tab=credits",
      tone: "warning",
      type: "lowCredits",
    });
  });

  it("routes paid-plan users with no credits to the credits tab and uses the out-of-credits state", () => {
    expect(
      resolveAccountNotice({
        credits: 0,
        currentPlan: "starter",
        email: "user@example.com",
        emailVerified: true,
        threshold: 500,
      }),
    ).toEqual({
      path: "/billing?tab=credits",
      tone: "destructive",
      type: "outOfCredits",
    });
  });

  it("still shows the out-of-credits notice when the threshold is zero", () => {
    expect(
      resolveAccountNotice({
        credits: 0,
        currentPlan: "starter",
        email: "user@example.com",
        emailVerified: true,
        threshold: 0,
      }),
    ).toEqual({
      path: "/billing?tab=credits",
      tone: "destructive",
      type: "outOfCredits",
    });
  });

  it("does not show the low-credits notice above zero when the threshold is zero", () => {
    expect(
      resolveAccountNotice({
        credits: 1,
        currentPlan: "starter",
        email: "user@example.com",
        emailVerified: true,
        threshold: 0,
      }),
    ).toBeNull();
  });

  it("does not show the low-credits notice when the balance equals the threshold", () => {
    expect(
      resolveAccountNotice({
        credits: 500,
        currentPlan: "starter",
        email: "user@example.com",
        emailVerified: true,
        threshold: 500,
      }),
    ).toBeNull();
  });

  it("does not show the low-credits notice when credits are unavailable", () => {
    expect(
      resolveAccountNotice({
        credits: null,
        currentPlan: "starter",
        email: "user@example.com",
        emailVerified: true,
        threshold: 500,
      }),
    ).toBeNull();
  });
});
