import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isProjectSocialProvider,
  PROJECT_SOCIAL_PROVIDERS,
  requireOwnTikTokAppAllowed,
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
const project = (slug: string | null, id: string) => ({
  workspace: { id, organization: slug ? { slug } : null },
});

it.each([
  ["utxo", utxoWorkspace],
  ["other", "other-workspace"],
  [null, "personal"],
] as const)(
  "opens TikTok to workspace %s (%s) once Core holds a Zernio key",
  (slug, id) => {
    vi.stubEnv("ZERNIO_API_KEY", "");
    expect(socialProviderWorkspace(slug, id).tiktokEnabled).toBe(false);
    expect(() =>
      requireSocialProviderEnabled("tiktok", project(slug, id)),
    ).toThrow(/coming soon/);

    vi.stubEnv("ZERNIO_API_KEY", "zernio-key");
    expect(socialProviderWorkspace(slug, id).tiktokEnabled).toBe(true);
    expect(() =>
      requireSocialProviderEnabled("tiktok", project(slug, id)),
    ).not.toThrow();
  },
);

it.each([
  ["Mainnet", "utxo", utxoWorkspace, true],
  ["Mainnet", "utxo", "other-workspace", false],
  ["Mainnet", "other", utxoWorkspace, false],
  ["Mainnet", null, "personal", false],
  ["Preprod", "utxo", utxoWorkspace, false],
] as const)(
  "keeps our own TikTok app to utxo's mainnet workspace: %s %s (%s)",
  (network, slug, id, allowed) => {
    vi.stubEnv("NETWORK", network);
    vi.stubEnv("ZERNIO_API_KEY", "zernio-key");
    const own = () => requireOwnTikTokAppAllowed(project(slug, id));
    if (allowed) expect(own).not.toThrow();
    else expect(own).toThrow(/no longer supported/);
  },
);
