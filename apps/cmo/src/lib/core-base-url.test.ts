import { afterEach, describe, expect, it } from "vitest";

import { resolveCoreBaseUrl } from "./core-base-url";

const MAINNET = "https://api.sokosumi.com";

afterEach(() => {
  delete process.env.VERCEL_RELATED_PROJECTS;
  delete process.env.VERCEL_ENV;
});

describe("resolveCoreBaseUrl", () => {
  it("uses CORE_APP_BASE_URL outside previews", () => {
    expect(
      resolveCoreBaseUrl({
        VERCEL_ENV: "production",
        CORE_APP_BASE_URL: MAINNET,
      }),
    ).toBe(MAINNET);
    expect(
      resolveCoreBaseUrl({ CORE_APP_BASE_URL: "http://localhost:8787" }),
    ).toBe("http://localhost:8787");
  });

  it("falls back to the branch's Core preview alias", () => {
    expect(
      resolveCoreBaseUrl({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feat/cmo-cuso-p0-p2",
        CORE_APP_BASE_URL: MAINNET,
      }),
    ).toBe(
      "https://sokosumi-core-mainnet-git-feat-cmo-cuso-p0-p2.preview.sokosumi.com",
    );
  });

  it("prefers the related project's preview host", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_RELATED_PROJECTS = JSON.stringify([
      {
        project: {
          id: "prj_GrqmJbIxWe0I6aYiZHZC2hiJYLiH",
          name: "sokosumi-core-mainnet",
        },
        preview: { branch: "core-preview.example.com" },
        production: { url: "api.sokosumi.com" },
      },
    ]);
    expect(
      resolveCoreBaseUrl({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feat/x",
        CORE_APP_BASE_URL: MAINNET,
      }),
    ).toBe("https://core-preview.example.com");
  });
});
