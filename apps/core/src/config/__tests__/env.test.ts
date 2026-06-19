import { describe, expect, it } from "vitest";

import { resolveWebRelatedProjectFallbackHost } from "../env.js";

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
        configuredWebAppBaseUrl: "http://localhost:3000",
        network: "Preprod",
      }),
    ).toBe("http://localhost:3000");
  });
});
