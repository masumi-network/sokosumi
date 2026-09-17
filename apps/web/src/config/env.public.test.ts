import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Turnstile public configuration", () => {
  it.each([
    ["development", "development"],
    ["production", "development"],
    ["production", "preview"],
    ["production", "production"],
  ])(
    "leaves the site key optional (NODE_ENV %s, Vercel %s)",
    async (nodeEnv, vercelEnv) => {
      vi.resetModules();
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", vercelEnv);
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);
      const { getEnvPublicConfig } = await import("./env.public");
      expect(
        getEnvPublicConfig().NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      ).toBeUndefined();
    },
  );

  it("preserves a configured site key", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    const { getEnvPublicConfig } = await import("./env.public");
    expect(getEnvPublicConfig().NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBe(
      "test-site-key",
    );
  });
});
