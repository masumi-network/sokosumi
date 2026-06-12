import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreAuthBaseUrl: () => "https://api.sokosumi.com/auth",
}));

import { GET } from "../route";

describe("oauth authorization server metadata route", () => {
  it("returns metadata pointing at core's auth server", async () => {
    const response = await GET();
    const metadata = await response.json();

    expect(metadata).toMatchObject({
      issuer: "https://api.sokosumi.com/auth",
      authorization_endpoint: "https://api.sokosumi.com/auth/oauth2/authorize",
      token_endpoint: "https://api.sokosumi.com/auth/oauth2/token",
      registration_endpoint: "https://api.sokosumi.com/auth/oauth2/register",
      revocation_endpoint: "https://api.sokosumi.com/auth/oauth2/revoke",
      introspection_endpoint: "https://api.sokosumi.com/auth/oauth2/introspect",
    });
  });
});
