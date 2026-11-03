import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  getWebAppBaseUrl: () => "https://app.sokosumi.com",
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
});
