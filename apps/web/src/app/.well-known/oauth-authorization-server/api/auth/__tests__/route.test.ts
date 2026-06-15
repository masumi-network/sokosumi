import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    BETTER_AUTH_URL: "https://app.sokosumi.com",
  }),
}));

import { GET } from "../route";

describe("oauth authorization server metadata route", () => {
  it("returns metadata at the canonical api/auth path", async () => {
    const response = await GET();
    const metadata = await response.json();

    expect(metadata).toMatchObject({
      issuer: "https://app.sokosumi.com/api/auth",
      authorization_endpoint:
        "https://app.sokosumi.com/api/auth/oauth2/authorize",
      token_endpoint: "https://app.sokosumi.com/api/auth/oauth2/token",
      registration_endpoint:
        "https://app.sokosumi.com/api/auth/oauth2/register",
      revocation_endpoint: "https://app.sokosumi.com/api/auth/oauth2/revoke",
      introspection_endpoint:
        "https://app.sokosumi.com/api/auth/oauth2/introspect",
    });
  });
});
