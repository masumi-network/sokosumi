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

afterEach(() => vi.unstubAllEnvs());

it("enables only the verified recording account's personal workspace in preview", () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_GIT_COMMIT_REF", "feat/tiktok-sandbox-recording");
  vi.stubEnv("NETWORK", "Preprod");
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

it("allows only the utxo organization in a Mainnet preview", () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_GIT_COMMIT_REF", "feat/tiktok-sandbox-recording");
  vi.stubEnv("NETWORK", "Mainnet");
  expect(socialProviderWorkspace("utxo").tiktokSandbox).toBe(true);
  expect(socialProviderWorkspace("other").tiktokSandbox).toBe(false);
  expect(
    socialProviderWorkspace(null, {
      email: "albina.nikiforova@nmkr.io",
      emailVerified: true,
    }).tiktokSandbox,
  ).toBe(false);
  vi.stubEnv("VERCEL_GIT_COMMIT_REF", "another-branch");
  expect(socialProviderWorkspace("utxo").tiktokSandbox).toBe(false);
  vi.stubEnv("VERCEL_GIT_COMMIT_REF", "feat/tiktok-sandbox-recording");
  vi.stubEnv("VERCEL_ENV", "production");
  expect(socialProviderWorkspace("utxo").tiktokSandbox).toBe(false);
});
