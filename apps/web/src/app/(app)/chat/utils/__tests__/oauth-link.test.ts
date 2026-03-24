import { describe, expect, it } from "vitest";
import { extractOAuthAuthorizationUrl } from "@/app/chat/utils/oauth-link";

describe("extractOAuthAuthorizationUrl", () => {
  it("extracts Hannah OAuth start links", () => {
    const text =
      "Please connect here: https://hannah.sumike.ai/oauth/sokosumi/start?source=responses&sokosumi_user_id=user_1";

    expect(extractOAuthAuthorizationUrl(text)).toBe(
      "https://hannah.sumike.ai/oauth/sokosumi/start?source=responses&sokosumi_user_id=user_1",
    );
  });

  it("extracts generic oauth authorize links for trusted domains", () => {
    const text =
      "Authorize at https://hannah.sumike.ai/oauth/authorize?client_id=1.";

    expect(extractOAuthAuthorizationUrl(text)).toBe(
      "https://hannah.sumike.ai/oauth/authorize?client_id=1",
    );
  });

  it("returns null for untrusted oauth authorize domains", () => {
    const text =
      "Authorize at https://evil.example/oauth/authorize?client_id=1";
    expect(extractOAuthAuthorizationUrl(text)).toBe(null);
  });

  it("returns null when no matching oauth link exists", () => {
    expect(extractOAuthAuthorizationUrl("Visit https://example.com/docs")).toBe(
      null,
    );
  });
});
