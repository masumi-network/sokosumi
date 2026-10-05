import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreAppBaseUrl: () => "https://core.sokosumi.com/",
}));

import {
  CORE_OAUTH_AUTHORIZATION_SERVER_WELL_KNOWN_PATH,
  redirectToCoreOAuthWellKnownResponse,
} from "@/lib/auth/oauth-issuer-well-known.server";

describe("redirectToCoreOAuthWellKnownResponse", () => {
  it("redirects to the canonical Core RFC 8414 metadata URL", () => {
    expect(CORE_OAUTH_AUTHORIZATION_SERVER_WELL_KNOWN_PATH).toBe(
      "/.well-known/oauth-authorization-server/auth",
    );
    const response = redirectToCoreOAuthWellKnownResponse();
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://core.sokosumi.com/.well-known/oauth-authorization-server/auth",
    );
  });
});
