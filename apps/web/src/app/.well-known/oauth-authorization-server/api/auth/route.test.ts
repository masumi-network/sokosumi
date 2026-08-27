import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreAppBaseUrl: () => "https://core.sokosumi.com",
}));

import { GET as getLegacyApiAuthPath, GET as getLegacyAuthPath } from "./route";

describe("legacy oauth authorization server metadata routes", () => {
  it("redirects the legacy auth path to Core well-known metadata", async () => {
    const response = await getLegacyAuthPath();

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://core.sokosumi.com/.well-known/oauth-authorization-server/auth",
    );
  });

  it("redirects the legacy api/auth path to Core well-known metadata", async () => {
    const response = await getLegacyApiAuthPath();

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://core.sokosumi.com/.well-known/oauth-authorization-server/auth",
    );
  });
});
