import { afterEach, expect, it, vi } from "vitest";

import { readCmoAuthConfig } from "./auth-config";

const SECRETS = {
  CORE_APP_BASE_URL: "https://api.sokosumi.com",
  SOKOSUMI_OAUTH_CLIENT_ID: "client",
  SOKOSUMI_OAUTH_CLIENT_SECRET: "secret",
  BETTER_AUTH_SECRET: "cookie-secret",
  OAUTH_PROXY_SECRET: "proxy-secret",
};

function stubEnv(env: Record<string, string>) {
  for (const [name, value] of Object.entries({ ...SECRETS, ...env })) {
    vi.stubEnv(name, value);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

it("signs production in on cmo.xyz, whatever Vercel names the project's production URL", () => {
  stubEnv({
    VERCEL_ENV: "production",
    VERCEL_PROJECT_PRODUCTION_URL: "sokosumi-cmo.preview.sokosumi.com",
  });

  const config = readCmoAuthConfig();

  expect(config.baseURL).toBe("https://cmo.xyz");
  expect(config.oauthProxy?.productionURL).toBe("https://cmo.xyz");
});

it("signs a preview in on its branch alias through cmo.xyz", () => {
  stubEnv({
    VERCEL_ENV: "preview",
    VERCEL_BRANCH_URL: "sokosumi-cmo-git-sok-1.preview.sokosumi.com",
    VERCEL_URL: "sokosumi-cmo-abc123.preview.sokosumi.com",
  });

  const config = readCmoAuthConfig();

  expect(config.baseURL).toBe(
    "https://sokosumi-cmo-git-sok-1.preview.sokosumi.com",
  );
  expect(config.oauthProxy?.productionURL).toBe("https://cmo.xyz");
});

it("signs in directly on BETTER_AUTH_URL locally", () => {
  stubEnv({ BETTER_AUTH_URL: "https://cmo.sokosumi.localhost" });

  const config = readCmoAuthConfig();

  expect(config.baseURL).toBe("https://cmo.sokosumi.localhost");
  expect(config.oauthProxy).toBeUndefined();
});
