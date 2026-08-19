import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveWebRelatedProjectFallbackHost, validateEnv } from "../env.js";

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
      SOKO_BOT_RUNTIME_BASE_URL: "https://runtime.example.com",
    });

    expectInvalidEnvironment(
      "SOKO_BOT_RUNTIME_ADAPTER must be eve when Soko Bot is enabled in a deployed environment",
    );
  });

  it.each([
    "not-a-url",
    "http://runtime.example.com",
    "https://localhost:2000",
    "https://runtime.localhost:2000",
    "https://127.0.0.1:2000",
    "https://[::1]:2000",
    "https://0.0.0.0:2000",
  ])("rejects deployed runtime URL %s", (runtimeBaseUrl) => {
    setSokoBotEnv({
      NODE_ENV: "production",
      SOKO_BOT_ENABLED: "true",
      SOKO_BOT_RUNTIME_ADAPTER: "eve",
      SOKO_BOT_RUNTIME_BASE_URL: runtimeBaseUrl,
    });

    expectInvalidEnvironment("SOKO_BOT_RUNTIME_BASE_URL");
  });

  it("accepts a pinned remote HTTPS Eve runtime in production", () => {
    setSokoBotEnv({
      NODE_ENV: "production",
      SOKO_BOT_ENABLED: "true",
      SOKO_BOT_RUNTIME_ADAPTER: "eve",
      SOKO_BOT_RUNTIME_BASE_URL: "https://soko-bot-runtime.example.com",
    });

    expect(validateEnv().SOKO_BOT_RUNTIME_BASE_URL).toBe(
      "https://soko-bot-runtime.example.com",
    );
  });

  it("keeps local HTTP and in-memory runtime available in development", () => {
    setSokoBotEnv({
      NODE_ENV: "development",
      SOKO_BOT_ENABLED: "true",
      SOKO_BOT_RUNTIME_ADAPTER: "in-memory",
      SOKO_BOT_RUNTIME_BASE_URL: "http://localhost:2000",
    });

    const config = validateEnv();

    expect(config.SOKO_BOT_RUNTIME_ADAPTER).toBe("in-memory");
    expect(config.SOKO_BOT_RUNTIME_BASE_URL).toBe("http://localhost:2000");
  });

  it("keeps the kill switch bootable with local defaults in production", () => {
    setSokoBotEnv({
      NODE_ENV: "production",
      SOKO_BOT_ENABLED: "false",
      SOKO_BOT_RUNTIME_ADAPTER: "in-memory",
      SOKO_BOT_RUNTIME_BASE_URL: "http://localhost:2000",
    });

    expect(validateEnv().SOKO_BOT_ENABLED).toBe(false);
  });
});
