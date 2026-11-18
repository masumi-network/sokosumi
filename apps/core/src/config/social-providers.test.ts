import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isProjectSocialProvider,
  PROJECT_SOCIAL_PROVIDERS,
  socialProviderWorkspace,
} from "./social-providers";

describe("isProjectSocialProvider", () => {
  it("accepts every configured Social provider", () => {
    for (const provider of Object.keys(PROJECT_SOCIAL_PROVIDERS)) {
      expect(isProjectSocialProvider(provider)).toBe(true);
    }
  });

  it.each(["twitter", "Twitter", "x ", "", "threads"])(
    "rejects %s",
    (provider) => {
      expect(isProjectSocialProvider(provider)).toBe(false);
    },
  );
});

vi.mock("@/config/env", () => ({
  getEnv: () => ({ COMPOSIO_TIKTOK_AUTH_CONFIG_ID: "ac_test" }),
}));
afterEach(() => vi.unstubAllEnvs());

it("enables only the verified recording account's personal workspace in preview", () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  const owner = { email: "Albina.Nikiforova@nmkr.io", emailVerified: true };
  expect(socialProviderWorkspace(null, owner).tiktokSandbox).toBe(true);
  expect(
    socialProviderWorkspace(null, { ...owner, email: "other@nmkr.io" })
      .tiktokSandbox,
  ).toBe(false);
  expect(
    socialProviderWorkspace(null, { ...owner, emailVerified: false })
      .tiktokSandbox,
  ).toBe(false);
  expect(socialProviderWorkspace(null).tiktokSandbox).toBe(false);
  expect(socialProviderWorkspace("utxo", owner).tiktokSandbox).toBe(false);
  vi.stubEnv("VERCEL_ENV", "production");
  expect(socialProviderWorkspace(null, owner).tiktokSandbox).toBe(false);
});
