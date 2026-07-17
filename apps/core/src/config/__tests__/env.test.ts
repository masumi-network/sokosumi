import { describe, expect, it } from "vitest";

import {
  resolveCorePreviewPublicBaseUrl,
  resolveWebRelatedProjectFallbackHost,
} from "../env.js";

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

describe("resolveCorePreviewPublicBaseUrl", () => {
  it("builds the Core branch preview host for Better Auth baseURL", () => {
    expect(
      resolveCorePreviewPublicBaseUrl({
        network: "Preprod",
        vercelEnv: "preview",
        vercelGitCommitRef: "fix/magic-link-preview",
      }),
    ).toBe(
      "https://sokosumi-core-preprod-git-fix-magic-link-preview.preview.sokosumi.com",
    );
  });

  it("uses the mainnet Core project name when NETWORK is Mainnet", () => {
    expect(
      resolveCorePreviewPublicBaseUrl({
        network: "Mainnet",
        vercelEnv: "preview",
        vercelGitCommitRef: "feat/auth",
      }),
    ).toBe("https://sokosumi-core-mainnet-git-feat-auth.preview.sokosumi.com");
  });

  it("returns undefined outside Vercel preview or without a branch ref", () => {
    expect(
      resolveCorePreviewPublicBaseUrl({
        network: "Preprod",
        vercelEnv: "production",
        vercelGitCommitRef: "main",
      }),
    ).toBeUndefined();

    expect(
      resolveCorePreviewPublicBaseUrl({
        network: "Preprod",
        vercelEnv: "preview",
        vercelGitCommitRef: "",
      }),
    ).toBeUndefined();
  });
});
