import { TURNSTILE_ALWAYS_PASS_SECRET } from "@sokosumi/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectCoreLog, expectCoreLogWhys } from "@/test/core-log";
import {
  invalidVariables,
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

function expectInvalidEnvironment(
  message: string,
  start = "Core cannot start, because environment variables are invalid",
) {
  const errors = expectCoreLog("error", start);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  expect(() => validateEnv()).toThrow("process.exit(1)");
  // The event names the variable, or says what is wrong with it.
  expect(JSON.stringify(errors.map((entry) => entry.event))).toContain(message);
  return errors;
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

describe("automatic ad eval configuration", () => {
  it("defaults off with bounded daily budgets", () => {
    for (const key of [
      "AD_EVALS_ENABLED",
      "AD_EVALS_PAUSED",
      "AD_EVALS_WORKSPACE_DAILY_LIMIT",
      "AD_EVALS_GLOBAL_DAILY_USD",
    ]) {
      vi.stubEnv(key, undefined);
    }
    const env = validateEnv();
    expect(env.AD_EVALS_ENABLED).toBe(false);
    expect(env.AD_EVALS_PAUSED).toBe(false);
    expect(env.AD_EVALS_WORKSPACE_DAILY_LIMIT).toBe(100);
    expect(env.AD_EVALS_GLOBAL_DAILY_USD).toBe(10);
  });

  it("accepts the flag, kill switch and zero budgets", () => {
    vi.stubEnv("AD_EVALS_ENABLED", "true");
    vi.stubEnv("AD_EVALS_PAUSED", "true");
    vi.stubEnv("AD_EVALS_WORKSPACE_DAILY_LIMIT", "0");
    vi.stubEnv("AD_EVALS_GLOBAL_DAILY_USD", "0");
    const env = validateEnv();
    expect(env.AD_EVALS_ENABLED).toBe(true);
    expect(env.AD_EVALS_PAUSED).toBe(true);
    expect(env.AD_EVALS_WORKSPACE_DAILY_LIMIT).toBe(0);
    expect(env.AD_EVALS_GLOBAL_DAILY_USD).toBe(0);
  });

  it.each([
    ["AD_EVALS_ENABLED", "yes"],
    ["AD_EVALS_PAUSED", "yes"],
    ["AD_EVALS_WORKSPACE_DAILY_LIMIT", "-1"],
    ["AD_EVALS_WORKSPACE_DAILY_LIMIT", "1.5"],
    ["AD_EVALS_GLOBAL_DAILY_USD", "-1"],
    ["AD_EVALS_GLOBAL_DAILY_USD", "Infinity"],
  ])("rejects invalid %s", (key, value) => {
    vi.stubEnv(key, value);
    expectInvalidEnvironment(key);
  });
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
  it("parses an exact SEO executor assertion and keeps paid search data opt-in", () => {
    const executor = {
      coworkerId: "seo-coworker",
      workspaceId: "9a7b54e5-0990-4fc5-890b-1f3e479f1c60",
      ownerId: "owner",
      organizationId: null,
    };
    vi.stubEnv("SEO_ANALYSIS_EXECUTOR", undefined);
    expect(validateEnv().SEO_ANALYSIS_EXECUTOR).toBeUndefined();
    vi.stubEnv("SEO_ANALYSIS_EXECUTOR", "");
    expect(validateEnv().SEO_ANALYSIS_EXECUTOR).toBeUndefined();
    vi.stubEnv("SEO_ANALYSIS_EXECUTOR", JSON.stringify(executor));
    expect(validateEnv().SEO_ANALYSIS_EXECUTOR).toEqual({
      ...executor,
      canUsePaidSearchData: false,
      canSchedule: false,
    });
    vi.stubEnv(
      "SEO_ANALYSIS_EXECUTOR",
      JSON.stringify({ ...executor, canUsePaidSearchData: true }),
    );
    expect(validateEnv().SEO_ANALYSIS_EXECUTOR?.canUsePaidSearchData).toBe(
      true,
    );
    vi.stubEnv(
      "SEO_ANALYSIS_EXECUTOR",
      JSON.stringify({ ...executor, canSchedule: true }),
    );
    expect(validateEnv().SEO_ANALYSIS_EXECUTOR?.canSchedule).toBe(true);
  });
  it("requires an explicit global SEO executor mode and keeps paid and scheduled work opt-in", () => {
    vi.stubEnv(
      "SEO_ANALYSIS_EXECUTOR",
      JSON.stringify({ mode: "global", coworkerId: "shared-seo" }),
    );
    expect(validateEnv().SEO_ANALYSIS_EXECUTOR).toEqual({
      mode: "global",
      coworkerId: "shared-seo",
      canUsePaidSearchData: false,
      canSchedule: false,
    });
    vi.stubEnv(
      "SEO_ANALYSIS_EXECUTOR",
      JSON.stringify({
        mode: "global",
        coworkerId: "shared-seo",
        canUsePaidSearchData: true,
        canSchedule: true,
      }),
    );
    expect(validateEnv().SEO_ANALYSIS_EXECUTOR).toEqual({
      mode: "global",
      coworkerId: "shared-seo",
      canUsePaidSearchData: true,
      canSchedule: true,
    });
  });
  it.each([
    { coworkerId: "shared-seo", canUsePaidSearchData: true, canSchedule: true },
    { mode: "global", coworkerId: "shared-seo", ownerId: "owner" },
    {
      mode: "global",
      coworkerId: "shared-seo",
      workspaceId: "9a7b54e5-0990-4fc5-890b-1f3e479f1c60",
    },
    { mode: "global", coworkerId: "shared-seo", organizationId: null },
    { mode: "global", canUsePaidSearchData: true },
    { mode: "all", coworkerId: "shared-seo" },
  ])(
    "rejects partial legacy and mixed global executor settings %j",
    (value) => {
      vi.stubEnv("SEO_ANALYSIS_EXECUTOR", JSON.stringify(value));
      expectInvalidEnvironment("SEO_ANALYSIS_EXECUTOR");
    },
  );
  it.each([
    "{",
    "null",
    "{}",
    JSON.stringify({
      coworkerId: "seo",
      workspaceId: "not-a-uuid",
      ownerId: "owner",
      organizationId: null,
    }),
    JSON.stringify({
      coworkerId: "seo",
      workspaceId: "9a7b54e5-0990-4fc5-890b-1f3e479f1c60",
      ownerId: "owner",
    }),
    JSON.stringify({
      coworkerId: "seo",
      workspaceId: "9a7b54e5-0990-4fc5-890b-1f3e479f1c60",
      ownerId: "owner",
      organizationId: null,
      canUsePaidSearchData: "true",
    }),
    JSON.stringify({
      coworkerId: "seo",
      workspaceId: "9a7b54e5-0990-4fc5-890b-1f3e479f1c60",
      ownerId: "owner",
      organizationId: null,
      canSchedule: "true",
    }),
    JSON.stringify({
      coworkerId: "seo",
      workspaceId: "9a7b54e5-0990-4fc5-890b-1f3e479f1c60",
      ownerId: "owner",
      organizationId: null,
      taskIds: [],
    }),
  ])("rejects malformed or widened SEO executor assertion %s", (value) => {
    vi.stubEnv("SEO_ANALYSIS_EXECUTOR", value);
    expectInvalidEnvironment("SEO_ANALYSIS_EXECUTOR");
  });
  it("keeps SEO analysis dispatch off unless the worker rollout is explicitly enabled", () => {
    vi.stubEnv("SEO_ANALYSIS_DISPATCH_ENABLED", undefined);
    expect(validateEnv().SEO_ANALYSIS_DISPATCH_ENABLED).toBe(false);
    vi.stubEnv("SEO_ANALYSIS_DISPATCH_ENABLED", "true");
    expect(validateEnv().SEO_ANALYSIS_DISPATCH_ENABLED).toBe(true);
    vi.stubEnv("SEO_ANALYSIS_DISPATCH_ENABLED", "false");
    expect(validateEnv().SEO_ANALYSIS_DISPATCH_ENABLED).toBe(false);
  });
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

describe("invalid environment event", () => {
  it("drops a message that quotes the variable's value", () => {
    // Zod 4's own messages never quote the input; a refinement's can.
    expect(
      invalidVariables(
        [
          {
            code: "custom",
            path: ["SEO_ANALYSIS_EXECUTOR"],
            message: 'rejected {"coworkerId":"seo-private-42"}',
            input: undefined,
          },
          {
            code: "too_small",
            path: ["OAUTH_PROXY_SECRET"],
            message: "Too small: expected string to have >=32 characters",
            minimum: 32,
            origin: "string",
            input: undefined,
          },
        ],
        {
          SEO_ANALYSIS_EXECUTOR: '{"coworkerId":"seo-private-42"}',
          OAUTH_PROXY_SECRET: "short",
        },
      ),
    ).toEqual([
      {
        variable: "SEO_ANALYSIS_EXECUTOR",
        path: "SEO_ANALYSIS_EXECUTOR",
        code: "custom",
      },
      {
        variable: "OAUTH_PROXY_SECRET",
        path: "OAUTH_PROXY_SECRET",
        code: "too_small",
        message: "Too small: expected string to have >=32 characters",
      },
    ]);
  });

  it("names the variable and what is wrong, never its value", () => {
    vi.stubEnv("OPENROUTER_DEFAULT_API_KEY", "sk-live-private-key-0042");
    vi.stubEnv("OAUTH_PROXY_SECRET", "too-short-private-secret");

    const errors = expectInvalidEnvironment("OPENROUTER_DEFAULT_API_KEY");

    expect(errors[0]?.fix).toContain("invalidVariables");
    expect(errors[0]?.event.invalidVariables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variable: "OPENROUTER_DEFAULT_API_KEY",
          code: "invalid_format",
        }),
        expect.objectContaining({
          variable: "OAUTH_PROXY_SECRET",
          code: "too_small",
        }),
      ]),
    );
    const drained = JSON.stringify(errors[0]?.event);
    expect(drained).not.toContain("sk-live-private-key");
    expect(drained).not.toContain("too-short-private-secret");
  });
});

describe("Newsletter environment", () => {
  it("allows an omitted webhook secret", () => {
    vi.stubEnv("RESEND_NEWSLETTER_WEBHOOK_SECRET", undefined);
    expect(validateEnv().RESEND_NEWSLETTER_WEBHOOK_SECRET).toBeUndefined();
  });

  it("rejects an empty webhook secret", () => {
    vi.stubEnv("RESEND_NEWSLETTER_WEBHOOK_SECRET", "");
    expectInvalidEnvironment("RESEND_NEWSLETTER_WEBHOOK_SECRET");
  });

  it("allows an omitted sending domain", () => {
    vi.stubEnv("NEWSLETTER_FROM_DOMAIN", undefined);
    expect(validateEnv().NEWSLETTER_FROM_DOMAIN).toBeUndefined();
  });

  it.each(["", "https://news.sokosumi.com", "news.sokosumi.com/path"])(
    "rejects an invalid sending hostname: %s",
    (value) => {
      vi.stubEnv("NEWSLETTER_FROM_DOMAIN", value);
      expectInvalidEnvironment("NEWSLETTER_FROM_DOMAIN");
    },
  );
});

describe("Polar environment", () => {
  it("allows a deployment without Polar settings", () => {
    vi.stubEnv("POLAR_ACCESS_TOKEN", undefined);
    vi.stubEnv("POLAR_WEBHOOK_SECRET", undefined);
    vi.stubEnv("POLAR_ENVIRONMENT", undefined);

    const env = validateEnv();

    expect(env.POLAR_ACCESS_TOKEN).toBeUndefined();
    expect(env.POLAR_WEBHOOK_SECRET).toBeUndefined();
    expect(env.POLAR_ENVIRONMENT).toBeUndefined();
  });

  it.each(["sandbox", "production"])("accepts the %s environment", (value) => {
    vi.stubEnv("POLAR_ENVIRONMENT", value);
    expect(validateEnv().POLAR_ENVIRONMENT).toBe(value);
  });

  it("rejects an unknown environment", () => {
    vi.stubEnv("POLAR_ENVIRONMENT", "staging");
    expectInvalidEnvironment("POLAR_ENVIRONMENT");
  });
});

describe("CMO hire allowlist", () => {
  it.each([
    [undefined, []],
    ["", []],
    [" , ", []],
    [
      " Lena@HarborBikes.com , @NMKR.io,,",
      ["lena@harborbikes.com", "@nmkr.io"],
    ],
  ])("parses %j as %j", (value, entries) => {
    vi.stubEnv("CMO_HIRE_ALLOWLIST", value);
    expect(validateEnv().CMO_HIRE_ALLOWLIST).toEqual(entries);
  });

  it("parses the subscription skip allowlist the same way", () => {
    vi.stubEnv("CMO_SUBSCRIPTION_SKIP_ALLOWLIST", " Tester@Acme.io , @QA.io,");
    expect(validateEnv().CMO_SUBSCRIPTION_SKIP_ALLOWLIST).toEqual([
      "tester@acme.io",
      "@qa.io",
    ]);
  });
});

describe("Turnstile deployment configuration", () => {
  const expectUnsetWarning = () =>
    expectCoreLogWhys(
      "warn",
      "Turnstile captcha verification is off in a deployed environment",
      [
        "TURNSTILE_SECRET_KEY is unset, so the auth email endpoints are unprotected from spam",
      ],
    );
  const expectTestSecretWarning = () =>
    expectCoreLogWhys(
      "warn",
      "Turnstile accepts every captcha token in this preview",
      [
        "TURNSTILE_SECRET_KEY is Cloudflare's published always-passes testing secret, so captcha verification accepts every token, including forged ones",
      ],
    );

  beforeEach(() => {
    vi.stubEnv("SOKO_BOT_RUNTIME_ADAPTER", "in-process");
  });

  it.each(["development", "production", "staging"])(
    "allows an omitted secret in Node %s",
    (nodeEnv) => {
      // Only production counts as deployed here.
      if (nodeEnv === "production") expectUnsetWarning();
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("TURNSTILE_SECRET_KEY", undefined);
      expect(validateEnv().TURNSTILE_SECRET_KEY).toBeUndefined();
    },
  );
  it.each(["production", "preview"])(
    "allows an omitted secret on Vercel %s",
    (vercelEnv) => {
      expectUnsetWarning();
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
    const warnings = expectUnsetWarning();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", undefined);

    validateEnv();

    expect(warnings[0]?.fix).toContain("Set TURNSTILE_SECRET_KEY");
    expect(warnings[0]?.event).toMatchObject({
      operation: "env_validation",
      envVariable: "TURNSTILE_SECRET_KEY",
    });
  });

  it("refuses to boot production with the always-passes test secret", () => {
    // Unlike an unset secret, this one serves a captcha that passes every
    // token, forged ones included, so the endpoints look protected. A warning
    // in a build log would not be read; production does not start.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_ALWAYS_PASS_SECRET);

    expectInvalidEnvironment(
      "always-passes testing secret",
      "Core cannot start in production with Turnstile's testing secret",
    );
  });

  it("refuses to boot Vercel production with the always-passes test secret", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_ALWAYS_PASS_SECRET);

    expectInvalidEnvironment(
      "always-passes testing secret",
      "Core cannot start in production with Turnstile's testing secret",
    );
  });

  it("warns but boots on a preview holding the always-passes test secret", () => {
    const warnings = expectTestSecretWarning();
    // Previews are throwaway, and a test key there is what lets an agent drive
    // the sign-in form without answering a human check. Failing would close
    // that door along with the hole.
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_ALWAYS_PASS_SECRET);

    expect(validateEnv().TURNSTILE_SECRET_KEY).toBe(
      TURNSTILE_ALWAYS_PASS_SECRET,
    );
    expect(warnings[0]?.event).toMatchObject({
      envVariable: "TURNSTILE_SECRET_KEY",
    });
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
    const warnings = expectTestSecretWarning();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_ALWAYS_PASS_SECRET);

    expect(validateEnv().TURNSTILE_SECRET_KEY).toBe(
      TURNSTILE_ALWAYS_PASS_SECRET,
    );
    expect(warnings[0]?.event).toMatchObject({
      envVariable: "TURNSTILE_SECRET_KEY",
    });
  });

  it("still refuses a Vercel production build holding the test secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_ALWAYS_PASS_SECRET);

    expectInvalidEnvironment(
      "always-passes testing secret",
      "Core cannot start in production with Turnstile's testing secret",
    );
  });

  it("stays quiet about the test secret on a local machine", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_ALWAYS_PASS_SECRET);

    validateEnv();

    // The console guard fails this test on any warning.
  });

  it("stays silent with a secret in a deployed environment", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");

    validateEnv();

    // The console guard fails this test on any warning.
  });

  it("stays silent without a secret in local development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("TURNSTILE_SECRET_KEY", undefined);

    validateEnv();

    // The console guard fails this test on any warning.
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
});

describe("ad evals admin organization environment", () => {
  it("keeps the organization slug and id optional", () => {
    vi.stubEnv("AD_EVALS_ADMIN_ORGANIZATION_SLUG", undefined);
    vi.stubEnv("AD_EVALS_ADMIN_ORGANIZATION_ID", undefined);

    const env = validateEnv();

    expect(env.AD_EVALS_ADMIN_ORGANIZATION_SLUG).toBeUndefined();
    expect(env.AD_EVALS_ADMIN_ORGANIZATION_ID).toBeUndefined();
  });

  it("trims configured organization values", () => {
    vi.stubEnv("AD_EVALS_ADMIN_ORGANIZATION_SLUG", " internal-workspace ");
    vi.stubEnv("AD_EVALS_ADMIN_ORGANIZATION_ID", " org-a ");

    const env = validateEnv();

    expect(env.AD_EVALS_ADMIN_ORGANIZATION_SLUG).toBe("internal-workspace");
    expect(env.AD_EVALS_ADMIN_ORGANIZATION_ID).toBe("org-a");
  });

  it.each([
    "AD_EVALS_ADMIN_ORGANIZATION_SLUG",
    "AD_EVALS_ADMIN_ORGANIZATION_ID",
  ])("rejects an empty %s", (key) => {
    vi.stubEnv(key, " ");
    expectInvalidEnvironment(key);
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

  it("warns when a preview has neither branch nor deployment URL", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Better Auth on this preview uses BETTER_AUTH_URL as its base URL",
      [
        "VERCEL_BRANCH_URL and VERCEL_URL are unset, so email links may point at the wrong host",
      ],
    );

    const { publicBase } = await urls({
      VERCEL_ENV: "preview",
      VERCEL_URL: undefined,
      VERCEL_BRANCH_URL: undefined,
      BETTER_AUTH_URL: "https://app.example.com/",
    });

    expect(publicBase).toBe("https://app.example.com");
    expect(warnings[0]?.event).toMatchObject({
      envVariable: "BETTER_AUTH_URL",
    });
  });

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

describe("native SEO chat allowance", () => {
  it("defaults to 100 daily turns and accepts an operator limit", () => {
    vi.stubEnv("SEO_CHAT_DAILY_TURN_LIMIT", undefined);
    expect(validateEnv().SEO_CHAT_DAILY_TURN_LIMIT).toBe(100);
    vi.stubEnv("SEO_CHAT_DAILY_TURN_LIMIT", "12");
    expect(validateEnv().SEO_CHAT_DAILY_TURN_LIMIT).toBe(12);
  });
  it.each(["0", "-1", "1.5", "invalid"])(
    "rejects an invalid allowance %s",
    (value) => {
      vi.stubEnv("SEO_CHAT_DAILY_TURN_LIMIT", value);
      expectInvalidEnvironment("SEO_CHAT_DAILY_TURN_LIMIT");
    },
  );
});
