import { describe, expect, it } from "vitest";
import { seoFirstPageCheckBody } from "./seo-first-check-model";
import { SEO_TEST_SCOPE, seoTestWorkspace } from "./seo-test-fixture";

describe("seoFirstPageCheckBody", () => {
  it("asks a new audit for a free HTML check of its scope in the page's market", () => {
    const workspace = seoTestWorkspace();
    workspace.pages[0].url = "https://example.de/";
    expect(seoFirstPageCheckBody(workspace, "first-check-key")).toEqual({
      kind: "page_check",
      scopeId: SEO_TEST_SCOPE,
      expectedScopeVersion: 2,
      keywords: [],
      countryCode: "DE",
      languageCode: "de",
      devices: ["mobile", "desktop"],
      competitorUrls: [],
      maxProviderCalls: 0,
      idempotencyKey: "first-check-key",
    });
  });

  it("starts nothing when the workspace cannot request a check", () => {
    const workspace = seoTestWorkspace();
    workspace.availableActions.canRequestAnalysis = false;
    expect(seoFirstPageCheckBody(workspace, "first-check-key")).toBeNull();
  });
});
