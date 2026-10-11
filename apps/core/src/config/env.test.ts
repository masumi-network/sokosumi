import { TURNSTILE_ALWAYS_PASS_SECRET } from "@sokosumi/utils";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isExplicitPreprod,
  resolveWebRelatedProjectFallbackHost,
  validateEnv,
} from "./env.js";

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
      "SOKO_BOT_RUNTIME_ADAPTER must be sandbox or in-process when Soko Bot is enabled in a deployed environment",
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

  /**
   * The shape a real Vercel preview has: Vercel builds every deployment with
   * NODE_ENV=production, previews included, so only VERCEL_ENV tells them
   * apart. Reading both with `||` made a preview look like production, and
   * Core exited at boot — every route answering FUNCTION_INVOCATION_FAILED
   * rather than serving with a warning. The test above misses it because it
   * leaves NODE_ENV alone.
   */
  it("warns but boots on a Vercel preview, where NODE_ENV is production too", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_ALWAYS_PASS_SECRET);

    expect(validateEnv().TURNSTILE_SECRET_KEY).toBe(
      TURNSTILE_ALWAYS_PASS_SECRET,
    );
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining("always-passes testing secret"),
    );
  });

  it("still refuses a Vercel production build holding the test secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_ALWAYS_PASS_SECRET);

    expectInvalidEnvironment("always-passes testing secret");
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

describe("Task tag classification environment", () => {
  it.each([
    [undefined, true],
    ["false", false],
  ])("parses %s as enabled=%s", (value, enabled) => {
    vi.stubEnv("TASK_TAG_CLASSIFICATION_ENABLED", value);
    expect(validateEnv().TASK_TAG_CLASSIFICATION_ENABLED).toBe(enabled);
  });
});

describe("Redis environment", () => {
  it("leaves Redis urls optional", () => {
    vi.stubEnv("REDIS_URL", undefined);
    vi.stubEnv("KV_URL", undefined);
    const config = validateEnv();
    expect(config.REDIS_URL).toBeUndefined();
    expect(config.KV_URL).toBeUndefined();
  });

  it("preserves REDIS_URL and KV_URL", () => {
    vi.stubEnv("REDIS_URL", "redis://primary");
    vi.stubEnv("KV_URL", "redis://kv");
    const config = validateEnv();
    expect(config.REDIS_URL).toBe("redis://primary");
    expect(config.KV_URL).toBe("redis://kv");
  });
});

// Core hands both values to the OAuth proxy, which steps aside only when they
// match. If they drift apart, production proxies its own sign-ins.
describe("Better Auth production URL", () => {
  async function urls(env: Record<string, string | undefined>) {
    // A deployed environment needs a Soko Bot runtime to boot.
    vi.stubEnv("SOKO_BOT_RUNTIME_ADAPTER", "in-process");
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.resetModules();
    const { getBetterAuthProductionUrl, getBetterAuthPublicBaseUrl } =
      await import("./env.js");
    return {
      production: getBetterAuthProductionUrl(),
      publicBase: getBetterAuthPublicBaseUrl(),
    };
  }

  it.each(["core.example.com", undefined])(
    "is production's public base URL (VERCEL_PROJECT_PRODUCTION_URL: %s)",
    async (productionUrl) => {
      const { production, publicBase } = await urls({
        VERCEL_ENV: "production",
        VERCEL_URL: "core-abc123.preview.example.com",
        VERCEL_BRANCH_URL: "core-git-x.preview.example.com",
        VERCEL_PROJECT_PRODUCTION_URL: productionUrl,
        BETTER_AUTH_URL: "https://app.example.com/",
      });

      expect(production).toBe(
        productionUrl ? `https://${productionUrl}` : "https://app.example.com",
      );
      expect(publicBase).toBe(production);
    },
  );

  it("is never a preview's public base URL", async () => {
    const { production, publicBase } = await urls({
      VERCEL_ENV: "preview",
      VERCEL_URL: "core-abc123.preview.example.com",
      VERCEL_BRANCH_URL: "core-git-x.preview.example.com",
      VERCEL_PROJECT_PRODUCTION_URL: "core.example.com",
      BETTER_AUTH_URL: "https://app.example.com",
    });

    expect(production).toBe("https://core.example.com");
    expect(publicBase).not.toBe(production);
  });
});

describe("isExplicitPreprod", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts Preprod only when NETWORK is set explicitly", () => {
    vi.stubEnv("NETWORK", "Preprod");
    expect(isExplicitPreprod({ NETWORK: "Preprod" })).toBe(true);
    vi.stubEnv("NETWORK", undefined);
    expect(isExplicitPreprod({ NETWORK: "Preprod" })).toBe(false);
    vi.stubEnv("NETWORK", "Mainnet");
    expect(isExplicitPreprod({ NETWORK: "Mainnet" })).toBe(false);
  });
});

describe("macOS minimum build", () => {
  beforeEach(() => {
    vi.stubEnv("SOKO_BOT_RUNTIME_ADAPTER", "in-process");
  });

  it("treats a blank minimum as unset", () => {
    vi.stubEnv("MACOS_MINIMUM_BUILD", "");
    expect(validateEnv().MACOS_MINIMUM_BUILD).toBeUndefined();
  });

  it("reads a configured minimum as a number", () => {
    vi.stubEnv("MACOS_MINIMUM_BUILD", "8000");
    expect(validateEnv().MACOS_MINIMUM_BUILD).toBe(8000);
  });
});
