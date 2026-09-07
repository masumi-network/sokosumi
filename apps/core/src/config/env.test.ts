import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("getWebAppBaseUrl", () => {
  /**
   * `getEnv` caches the parsed environment at module scope, so each case gets
   * a fresh module rather than a shared one that froze the first case's
   * values.
   */
  async function loadWebAppBaseUrl(
    caseOverrides: Record<string, string | undefined>,
  ): Promise<string> {
    // A deployed environment rejects the suite's in-memory Soko Bot adapter,
    // and a rejected environment exits the process before any URL is read.
    const overrides = {
      SOKO_BOT_RUNTIME_ADAPTER: "in-process",
      ...caseOverrides,
    };
    const previous = Object.fromEntries(
      Object.keys(overrides).map((key) => [key, process.env[key]]),
    );

    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    try {
      vi.resetModules();
      const { getWebAppBaseUrl } = await import("./env.js");
      return getWebAppBaseUrl();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      vi.resetModules();
    }
  }

  it.each([
    ["Mainnet", "https://app.sokosumi.com"],
    ["Preprod", "https://preprod.sokosumi.com"],
  ])(
    "answers the canonical %s domain on Vercel production",
    async (network, expected) => {
      await expect(
        loadWebAppBaseUrl({ NETWORK: network, VERCEL_ENV: "production" }),
      ).resolves.toBe(expected);
    },
  );

  it("ignores the related project on production, whatever it reports", async () => {
    // The bug: `withRelatedProject` falls back to `production.url`, the
    // per-deployment host whose hash changes with every web deploy. A reader
    // who follows such a link keeps the app on that origin, and the browser
    // ties their push subscription to it.
    await expect(
      loadWebAppBaseUrl({
        NETWORK: "Mainnet",
        VERCEL_ENV: "production",
        VERCEL_RELATED_PROJECTS: JSON.stringify([
          {
            project: { id: "prj_test", name: "sokosumi-app-mainnet" },
            production: {
              url: "sokosumi-app-mainnet-od9mmtb7d.preview.sokosumi.com",
            },
            preview: {},
          },
        ]),
      }),
    ).resolves.toBe("https://app.sokosumi.com");
  });

  it("still asks the related project on Vercel preview", async () => {
    await expect(
      loadWebAppBaseUrl({
        NETWORK: "Mainnet",
        VERCEL_ENV: "preview",
        VERCEL_RELATED_PROJECTS: JSON.stringify([
          {
            project: { id: "prj_test", name: "sokosumi-app-mainnet" },
            production: {},
            preview: {
              branch: "sokosumi-app-mainnet-git-topic.preview.sokosumi.com",
            },
          },
        ]),
      }),
    ).resolves.toBe(
      "https://sokosumi-app-mainnet-git-topic.preview.sokosumi.com",
    );
  });

  it("uses the configured URL when there is no Vercel environment", async () => {
    await expect(
      loadWebAppBaseUrl({
        VERCEL_ENV: undefined,
        VERCEL_RELATED_PROJECTS: undefined,
        WEB_APP_BASE_URL: "http://localhost:3000",
      }),
    ).resolves.toBe("http://localhost:3000");
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
