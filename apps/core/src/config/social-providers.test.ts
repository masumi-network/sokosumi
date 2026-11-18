import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isProjectSocialProvider,
  PROJECT_SOCIAL_PROVIDERS,
  requireSocialProviderEnabled,
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

const utxoWorkspace = "03d70dc0-f302-45d5-a161-86beb31d2448";

it.each([
  ["Mainnet", "utxo", utxoWorkspace, true],
  ["Mainnet", "utxo", "other-workspace", false],
  ["Mainnet", "other", utxoWorkspace, false],
  ["Mainnet", null, "personal", false],
  ["Preprod", "utxo", utxoWorkspace, false],
] as const)(
  "checks %s workspace %s (%s) for discovery and connection",
  (network, slug, id, allowed) => {
    vi.stubEnv("NETWORK", network);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(socialProviderWorkspace(slug, id).tiktokEnabled).toBe(allowed);
    const project = { workspace: { id, organization: slug ? { slug } : null } };
    const connect = () => requireSocialProviderEnabled("tiktok", project);
    if (allowed) expect(connect).not.toThrow();
    else expect(connect).toThrow(/coming soon/);
  },
);
