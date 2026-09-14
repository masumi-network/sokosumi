import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Turnstile public configuration", () => {
  it.each(["production", "preview"])(
    "requires the public key on Vercel %s",
    async (environment) => {
      vi.resetModules();
      vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", environment);
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("invalid configuration");
      });
      const { getEnvPublicConfig } = await import("./env.public");
      expect(() => getEnvPublicConfig()).toThrow("invalid configuration");
      expect(JSON.stringify(error.mock.calls)).toContain(
        "NEXT_PUBLIC_TURNSTILE_SITE_KEY is required",
      );
    },
  );

  it("supports local development without loading a widget", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);
    const { getEnvPublicConfig } = await import("./env.public");
    expect(getEnvPublicConfig().NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBeUndefined();
  });
});
