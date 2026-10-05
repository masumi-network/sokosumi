import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readCmoAuthConfig, readSokosumiAppBaseUrl } from "./auth-config";

const CORE_ALIAS = "sokosumi-core-mainnet-git-feat-long-branch-name-fceb86";
const WEB_ALIAS = "sokosumi-app-mainnet-git-feat-long-branch-name-1a2b3c";

/** `VERCEL_RELATED_PROJECTS` as Vercel sets it for a preview build. */
function relatedProjects(branch: string | undefined, webBranch?: string) {
  return JSON.stringify([
    {
      project: { id: "prj_core", name: "sokosumi-core-mainnet" },
      production: { alias: "api.sokosumi.com" },
      preview: { branch },
    },
    {
      project: { id: "prj_web", name: "sokosumi-app-mainnet" },
      production: { alias: "app.sokosumi.com" },
      preview: { branch: webBranch },
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
    // As observed on a CMO preview: Core's alias with CMO's own suffix.
    vi.stubEnv(
      "VERCEL_RELATED_PROJECTS",
      relatedProjects(`${CORE_ALIAS}.preview.cmo.xyz`),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs a preview in against its branch's Core preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_BRANCH_URL", "sokosumi-cmo-git-feat.preview.cmo.xyz");

    expect(readCmoAuthConfig()).toMatchObject({
      baseURL: "https://sokosumi-cmo-git-feat.preview.cmo.xyz",
      coreBaseUrl: `https://${CORE_ALIAS}.preview.sokosumi.com`,
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

describe("readSokosumiAppBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("SOKOSUMI_APP_BASE_URL", "");
    vi.stubEnv("VERCEL_RELATED_PROJECTS", "");
  });

  it("links to Sokosumi production when nothing is set", () => {
    expect(readSokosumiAppBaseUrl()).toBe("https://app.sokosumi.com");
  });

  it("links to SOKOSUMI_APP_BASE_URL in production and locally", () => {
    vi.stubEnv("SOKOSUMI_APP_BASE_URL", "https://app.preprod.sokosumi.com/");

    expect(readSokosumiAppBaseUrl()).toBe("https://app.preprod.sokosumi.com");
  });

  it("links a preview to its branch's Sokosumi preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    // A preview's invitations are in its branch's database, never production's.
    vi.stubEnv("SOKOSUMI_APP_BASE_URL", "https://app.sokosumi.com");
    vi.stubEnv(
      "VERCEL_RELATED_PROJECTS",
      relatedProjects(undefined, `${WEB_ALIAS}.preview.cmo.xyz`),
    );

    expect(readSokosumiAppBaseUrl()).toBe(
      `https://${WEB_ALIAS}.preview.sokosumi.com`,
    );
  });

  it.each([
    ["no related projects", ""],
    ["no Sokosumi preview for the branch", relatedProjects(undefined)],
  ])(
    "refuses a preview with %s instead of using production",
    (_label, value) => {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("SOKOSUMI_APP_BASE_URL", "https://app.sokosumi.com");
      vi.stubEnv("VERCEL_RELATED_PROJECTS", value);

      expect(() => readSokosumiAppBaseUrl()).toThrow(
        "sokosumi-app-mainnet has no preview for this branch",
      );
    },
  );
});
