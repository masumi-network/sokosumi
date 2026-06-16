import { beforeEach, describe, expect, it, vi } from "vitest";

const getEnvPublicConfigMock = vi.fn();

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => getEnvPublicConfigMock(),
}));

import { getBrowserCoreAuthBaseUrl } from "@/lib/clients/utils/core-api-base-url.browser";
import { normalizeOAuthIssuerBase } from "@/lib/utils/oauth-issuer";

describe("oauth callback issuer", () => {
  beforeEach(() => {
    getEnvPublicConfigMock.mockReturnValue({
      NEXT_PUBLIC_NETWORK: "Preprod",
      NEXT_PUBLIC_CORE_APP_BASE_URL: "http://localhost:8787/v1",
    });
  });

  it("expects Core auth base URL as issuer, not web /api/auth", () => {
    const coreIssuer = normalizeOAuthIssuerBase(getBrowserCoreAuthBaseUrl());
    const legacyWebIssuer = normalizeOAuthIssuerBase(
      "http://localhost:3000/api/auth",
    );

    expect(coreIssuer).toBe("http://localhost:8787/auth");
    expect(coreIssuer).not.toBe(legacyWebIssuer);
  });
});
