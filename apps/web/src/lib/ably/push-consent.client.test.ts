import { beforeEach, describe, expect, it, vi } from "vitest";

const { env } = vi.hoisted(() => ({
  env: {
    NEXT_PUBLIC_NETWORK: "Mainnet",
    NEXT_PUBLIC_VERCEL_ENV: "production",
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: "main",
  },
}));
vi.mock("@/config/env.public", () => ({ getEnvPublicConfig: () => env }));

import {
  readPushConsentId,
  rememberPushConsentId,
} from "./push-consent.client";

beforeEach(() => {
  localStorage.clear();
  env.NEXT_PUBLIC_VERCEL_ENV = "production";
  env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF = "main";
});

describe("durable browser push consent", () => {
  it("reads retained consent after loading the module again", async () => {
    rememberPushConsentId("user-1", "consent-1");
    vi.resetModules();
    const reloaded = await import("./push-consent.client");
    expect(reloaded.readPushConsentId("user-1")).toBe("consent-1");
  });

  it("keeps consent separate for each account and exact notification channel", () => {
    rememberPushConsentId("user-1", "production-consent");
    expect(readPushConsentId("user-2")).toBeUndefined();
    env.NEXT_PUBLIC_VERCEL_ENV = "preview";
    env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF = "branch-one";
    expect(readPushConsentId("user-1")).toBeUndefined();
    rememberPushConsentId("user-1", "preview-consent");
    env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF = "branch-two";
    expect(readPushConsentId("user-1")).toBeUndefined();
    env.NEXT_PUBLIC_VERCEL_ENV = "production";
    expect(readPushConsentId("user-1")).toBe("production-consent");
  });

  it("does not silently lose the stable identity when storage is blocked", () => {
    const storage = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    try {
      expect(() => readPushConsentId("user-1")).toThrow("Storage blocked");
    } finally {
      storage.mockRestore();
    }
  });
});
