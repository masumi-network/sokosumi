import { describe, expect, it, vi } from "vitest";

import {
  ABLY_CLIENT_TOKEN_TTL_MS,
  createAblyClientTokenRequest,
} from "./create-token-request";

const { createTokenRequestMock } = vi.hoisted(() => ({
  createTokenRequestMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    ABLY_SUBSCRIBE_ONLY_KEY: "app.key:secret",
    NETWORK: "Mainnet",
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "main",
  }),
}));

vi.mock("ably", () => ({
  Rest: class {
    auth = { createTokenRequest: createTokenRequestMock };
  },
}));

describe("createAblyClientTokenRequest", () => {
  it("requests a five minute ttl so revoked membership expires quickly", async () => {
    createTokenRequestMock.mockResolvedValue({ keyName: "app.key" });

    await createAblyClientTokenRequest({
      userId: "user_123",
      roomIds: ["room_1"],
      organizationIds: ["org_1"],
      workspaceIds: [],
      clientInstanceId: "abcdef0123456789",
    });

    expect(ABLY_CLIENT_TOKEN_TTL_MS).toBe(300_000);
    expect(createTokenRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: expect.stringContaining("user_123"),
        ttl: ABLY_CLIENT_TOKEN_TTL_MS,
      }),
    );
  });
});
