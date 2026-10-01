import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readCmoAuthConfig } from "./auth-config";

const CORE_PREVIEW =
  "sokosumi-core-mainnet-git-feat-long-branch-name-fceb86.preview.sokosumi.com";

/** `VERCEL_RELATED_PROJECTS` as Vercel sets it for a preview build. */
function relatedProjects(branch: string | undefined) {
  return JSON.stringify([
    {
      project: { id: "prj_core", name: "sokosumi-core-mainnet" },
      production: { alias: "api.sokosumi.com" },
      preview: { branch },
    },
  ]);
}

describe("readCmoAuthConfig", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_URL", "https://cmo.sokosumi.localhost");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-cookie-secret-of-at-least-32-chars");
    vi.stubEnv("SOKOSUMI_OAUTH_CLIENT_ID", "cmo-client");
    vi.stubEnv("SOKOSUMI_OAUTH_CLIENT_SECRET", "cmo-secret");
    vi.stubEnv("CORE_APP_BASE_URL", "https://api.sokosumi.com/");
    vi.stubEnv("VERCEL_RELATED_PROJECTS", relatedProjects(CORE_PREVIEW));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs a preview in against its branch's Core preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_BRANCH_URL", "sokosumi-cmo-git-feat.preview.cmo.xyz");

    expect(readCmoAuthConfig()).toMatchObject({
      baseURL: "https://sokosumi-cmo-git-feat.preview.cmo.xyz",
      coreBaseUrl: `https://${CORE_PREVIEW}`,
    });
  });

  it.each([
    ["no related projects", undefined],
    ["no Core preview for the branch", relatedProjects(undefined)],
  ])("refuses a preview with %s instead of using mainnet", (_label, value) => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_BRANCH_URL", "sokosumi-cmo-git-feat.preview.cmo.xyz");
    vi.stubEnv("VERCEL_RELATED_PROJECTS", value);

    expect(() => readCmoAuthConfig()).toThrow(
      "sokosumi-core-mainnet has no preview for this branch",
    );
  });

  it("signs production in against CORE_APP_BASE_URL", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.cmo.xyz");

    expect(readCmoAuthConfig()).toMatchObject({
      baseURL: "https://app.cmo.xyz",
      coreBaseUrl: "https://api.sokosumi.com",
    });
  });

  it("signs in locally against CORE_APP_BASE_URL", () => {
    expect(readCmoAuthConfig()).toMatchObject({
      baseURL: "https://cmo.sokosumi.localhost",
      coreBaseUrl: "https://api.sokosumi.com",
    });
  });
});
