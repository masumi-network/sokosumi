import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEnv } from "@/config/env";
import { isSeoAnalysisDispatchEnabled } from "./analysis-dispatch";

const env = getEnv();
const previous = {
  NETWORK: env.NETWORK,
  VERCEL_ENV: env.VERCEL_ENV,
  SEO_ANALYSIS_EXECUTOR: env.SEO_ANALYSIS_EXECUTOR,
  SEO_ANALYSIS_DISPATCH_ENABLED: env.SEO_ANALYSIS_DISPATCH_ENABLED,
};

describe("native SEO deployment defaults", () => {
  beforeEach(() => {
    env.NETWORK = "Mainnet";
    env.VERCEL_ENV = "production";
    env.SEO_ANALYSIS_EXECUTOR = undefined;
    env.SEO_ANALYSIS_DISPATCH_ENABLED = false;
    vi.stubEnv("SEO_ANALYSIS_DISPATCH_ENABLED", undefined);
  });
  afterEach(() => {
    Object.assign(env, previous);
    vi.unstubAllEnvs();
  });

  it("enables the live Mainnet service without custom SEO variables", () => {
    expect(isSeoAnalysisDispatchEnabled()).toBe(true);
  });

  it.each([
    ["Mainnet", "preview"],
    ["Mainnet", "development"],
    ["Mainnet", undefined],
    ["Preprod", "production"],
    ["Preprod", "preview"],
  ] as const)("keeps %s/%s deployments opt-in", (network, deployment) => {
    env.NETWORK = network;
    env.VERCEL_ENV = deployment;
    expect(isSeoAnalysisDispatchEnabled()).toBe(false);
  });

  it("honors an explicit disabled override on live Mainnet", () => {
    vi.stubEnv("SEO_ANALYSIS_DISPATCH_ENABLED", "false");
    expect(isSeoAnalysisDispatchEnabled()).toBe(false);
  });

  it("does not implicitly enable an operator-supplied executor", () => {
    env.SEO_ANALYSIS_EXECUTOR = {
      mode: "global",
      coworkerId: "operator-service",
      canUsePaidSearchData: false,
      canSchedule: false,
    };
    expect(isSeoAnalysisDispatchEnabled()).toBe(false);
  });

  it("keeps existing explicit enablement available on Preprod", () => {
    env.NETWORK = "Preprod";
    env.SEO_ANALYSIS_DISPATCH_ENABLED = true;
    expect(isSeoAnalysisDispatchEnabled()).toBe(true);
  });
});
