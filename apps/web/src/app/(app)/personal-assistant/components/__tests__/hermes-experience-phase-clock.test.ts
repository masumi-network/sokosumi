import { describe, expect, it } from "vitest";

import {
  shouldClearSetupPhaseClock,
  shouldOfferHermesStartOver,
} from "@/app/personal-assistant/components/hermes-setup-recovery";

describe("shouldClearSetupPhaseClock", () => {
  it("keeps the clock across error and loading so Retry cannot reset the deadline", () => {
    expect(shouldClearSetupPhaseClock("error")).toBe(false);
    expect(shouldClearSetupPhaseClock("loading")).toBe(false);
  });

  it("clears when leaving for a real phase (success, wizard, or idle)", () => {
    expect(shouldClearSetupPhaseClock("idle")).toBe(true);
    expect(shouldClearSetupPhaseClock("provisioning")).toBe(true);
    expect(shouldClearSetupPhaseClock("infrastructure_ready")).toBe(true);
    expect(shouldClearSetupPhaseClock("onboarding")).toBe(true);
    expect(shouldClearSetupPhaseClock("running")).toBe(true);
  });
});

describe("shouldOfferHermesStartOver", () => {
  it("hides Start over in preview or when there is no instance", () => {
    expect(
      shouldOfferHermesStartOver({
        previewMode: true,
        instanceStatus: "error",
        isProvisionTimeout: true,
      }),
    ).toBe(false);
    expect(
      shouldOfferHermesStartOver({
        previewMode: false,
        instanceStatus: null,
        isProvisionTimeout: true,
      }),
    ).toBe(false);
  });

  it("offers Start over for orch error and stuck provisioning", () => {
    expect(
      shouldOfferHermesStartOver({
        previewMode: false,
        instanceStatus: "error",
        isProvisionTimeout: false,
      }),
    ).toBe(true);
    expect(
      shouldOfferHermesStartOver({
        previewMode: false,
        instanceStatus: "provisioning",
        isProvisionTimeout: false,
      }),
    ).toBe(true);
  });

  it("offers Start over after a client provision timeout even if status drifted", () => {
    expect(
      shouldOfferHermesStartOver({
        previewMode: false,
        instanceStatus: "infrastructure_ready",
        isProvisionTimeout: true,
      }),
    ).toBe(true);
  });
});
