import { TURNSTILE_ALWAYS_PASS_SECRET } from "@sokosumi/utils";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveWebRelatedProjectFallbackHost, validateEnv } from "./env.js";

const SOKO_BOT_ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "SOKO_BOT_ENABLED",
  "SOKO_BOT_RUNTIME_ADAPTER",
  "SOKO_BOT_RUNTIME_BASE_URL",
] as const;
const originalSokoBotEnv = Object.fromEntries(
  SOKO_BOT_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function setSokoBotEnv(
  values: Partial<Record<(typeof SOKO_BOT_ENV_KEYS)[number], string>>,
) {
  for (const key of SOKO_BOT_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function expectInvalidEnvironment(message: string) {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  expect(() => validateEnv()).toThrow("process.exit(1)");
  expect(JSON.stringify(consoleError.mock.calls)).toContain(message);
}

afterEach(() => {
  for (const key of SOKO_BOT_ENV_KEYS) {
    const value = originalSokoBotEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("resolveWebRelatedProjectFallbackHost", () => {
  it("uses the matching branch web preview host on Vercel preview", () => {
    expect(
      resolveWebRelatedProjectFallbackHost({
        configuredWebAppBaseUrl: "https://preprod.sokosumi.com",
        network: "Preprod",
        vercelEnv: "preview",
        vercelGitCommitRef: "fix/web-preview-core-url",
      }),
    ).toBe(
      "https://sokosumi-app-preprod-git-fix-web-preview-core-url.preview.sokosumi.com",
    );
  });

  it("falls back to the configured web app URL outside branch previews", () => {
    expect(
      resolveWebRelatedProjectFallbackHost({
        configuredWebAppBaseUrl: "[REDACTED]",
        network: "Preprod",
      }),
    ).toBe("[REDACTED]");
  });
});

describe("Soko Bot deployment environment", () => {
  it.each([
    ["Node production", { NODE_ENV: "production" }],
    ["Vercel preview", { NODE_ENV: "development", VERCEL_ENV: "preview" }],
    [
      "Vercel production",
      { NODE_ENV: "development", VERCEL_ENV: "production" },
    ],
  ])("rejects the in-memory adapter in %s", (_name, deploymentEnv) => {
    setSokoBotEnv({
      ...deploymentEnv,
      SOKO_BOT_ENABLED: "true",
      SOKO_BOT_RUNTIME_ADAPTER: "in-memory",
    });

    expectInvalidEnvironment(
      "SOKO_BOT_RUNTIME_ADAPTER must be in-process when Soko Bot is enabled in a deployed environment",
    );
  });

  it("needs no runtime deployment or signing key to enable in production", () => {
    setSokoBotEnv({
      NODE_ENV: "production",
      SOKO_BOT_ENABLED: "true",
      SOKO_BOT_RUNTIME_ADAPTER: "in-process",
    });

    const config = validateEnv();

    expect(config.SOKO_BOT_ENABLED).toBe(true);
    expect(config.SOKO_BOT_RUNTIME_ADAPTER).toBe("in-process");
  });

  it("keeps the in-memory runtime available in development", () => {
    setSokoBotEnv({
      NODE_ENV: "development",
      SOKO_BOT_ENABLED: "true",
      SOKO_BOT_RUNTIME_ADAPTER: "in-memory",
    });

    expect(validateEnv().SOKO_BOT_RUNTIME_ADAPTER).toBe("in-memory");
  });

  it("keeps the kill switch bootable with local defaults in production", () => {
    setSokoBotEnv({
      NODE_ENV: "production",
      SOKO_BOT_ENABLED: "false",
      SOKO_BOT_RUNTIME_ADAPTER: "in-memory",
    });

    expect(validateEnv().SOKO_BOT_ENABLED).toBe(false);
  });
});

describe("Turnstile deployment configuration", () => {
  let consoleWarn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    vi.stubEnv("SOKO_BOT_RUNTIME_ADAPTER", "in-process");
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it.each(["development", "production", "staging"])(
    "allows an omitted secret in Node %s",
    (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("TURNSTILE_SECRET_KEY", undefined);
      expect(validateEnv().TURNSTILE_SECRET_KEY).toBeUndefined();
    },
  );
  it.each(["production", "preview"])(
    "allows an omitted secret on Vercel %s",
    (vercelEnv) => {
      vi.stubEnv("VERCEL_ENV", vercelEnv);
      vi.stubEnv("TURNSTILE_SECRET_KEY", undefined);
      expect(validateEnv().TURNSTILE_SECRET_KEY).toBeUndefined();
    },
  );
  it("preserves a configured secret", () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    expect(validateEnv().TURNSTILE_SECRET_KEY).toBe("test-secret");
  });

  it("warns when the secret is omitted in a deployed environment", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", undefined);

    validateEnv();

    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining("TURNSTILE_SECRET_KEY is unset"),
    );
  });

  it("refuses to boot production with the always-passes test secret", () => {
    // Unlike an unset secret, this one serves a captcha that passes every
    // token, forged ones included, so the endpoints look protected. A warning
    // in a build log would not be read; production does not start.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_ALWAYS_PASS_SECRET);

    expectInvalidEnvironment("always-passes testing secret");
  });

  it("refuses to boot Vercel production with the always-passes test secret", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_ALWAYS_PASS_SECRET);

    expectInvalidEnvironment("always-passes testing secret");
  });

  it("warns but boots on a preview holding the always-passes test secret", () => {
    // Previews are throwaway, and a test key there is what lets an agent drive
    // the sign-in form without answering a human check. Failing would close
    // that door along with the hole.
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_ALWAYS_PASS_SECRET);

    expect(validateEnv().TURNSTILE_SECRET_KEY).toBe(
      TURNSTILE_ALWAYS_PASS_SECRET,
    );
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining("always-passes testing secret"),
    );
  });

  it("stays quiet about the test secret on a local machine", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_ALWAYS_PASS_SECRET);

    validateEnv();

    expect(consoleWarn).not.toHaveBeenCalledWith(
      expect.stringContaining("always-passes testing secret"),
    );
  });

  it("stays silent with a secret in a deployed environment", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");

    validateEnv();

    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("stays silent without a secret in local development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("TURNSTILE_SECRET_KEY", undefined);

    validateEnv();

    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
