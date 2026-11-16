import { describe, expect, it, vi } from "vitest";

const previewOrigin = vi.hoisted(
  () =>
    "https://sokosumi-app-preprod-git-feat-seo-workspace.preview.sokosumi.com",
);
vi.mock("@/config/env", () => ({
  getEnv: () => ({ WEB_APP_BASE_URL: "https://app.sokosumi.com" }),
  getWebAppBaseUrl: () => previewOrigin,
}));

import { composioHandoffUrl } from "./composio-handoff";

const redirectUrl = "https://connect.composio.dev/link/abc";

describe("composioHandoffUrl", () => {
  it("sends a connect that returns to CMO through Web's hand-off page", () => {
    const url = new URL(
      composioHandoffUrl({
        redirectUrl,
        returnUrl: "https://app.cmo.xyz/connect/callback",
        connectionId: "ca_1",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://app.sokosumi.com/composio/handoff",
    );
    expect(url.searchParams.get("to")).toBe(redirectUrl);
    expect(url.searchParams.get("return")).toBe(
      "https://app.cmo.xyz/connect/callback",
    );
    expect(url.searchParams.get("connection")).toBe("ca_1");
  });

  it("leaves Web's own connects and connects without a return address alone", () => {
    expect(
      composioHandoffUrl({
        redirectUrl,
        returnUrl: "https://app.sokosumi.com/composio/callback",
      }),
    ).toBe(redirectUrl);
    expect(composioHandoffUrl({ redirectUrl, returnUrl: undefined })).toBe(
      redirectUrl,
    );
  });

  it("uses the canonical verifier host when the return address is a Preview", () => {
    const callback = `${previewOrigin}/seo/connections/callback?provider=ga4&seo_state=attempt-123`;
    const handoff = new URL(
      composioHandoffUrl({
        redirectUrl,
        returnUrl: callback,
        connectionId: "ca-native",
      }),
    );
    expect(handoff.origin + handoff.pathname).toBe(
      "https://app.sokosumi.com/composio/handoff",
    );
    expect(handoff.searchParams.get("return")).toBe(callback);
    expect(handoff.searchParams.get("connection")).toBe("ca-native");
  });

  it("preserves a same-origin native SEO callback so it can redeem consent before notifying the opener", () => {
    const callback =
      "https://app.sokosumi.com/seo/connections/callback?provider=ga4&viewer=alice&seo_state=attempt-123";
    const handoff = new URL(
      composioHandoffUrl({
        redirectUrl,
        returnUrl: callback,
        connectionId: "ca-native",
      }),
    );
    expect(handoff.origin + handoff.pathname).toBe(
      "https://app.sokosumi.com/composio/handoff",
    );
    expect(handoff.searchParams.get("to")).toBe(redirectUrl);
    expect(handoff.searchParams.get("return")).toBe(callback);
    expect(handoff.searchParams.get("connection")).toBe("ca-native");
  });
});
