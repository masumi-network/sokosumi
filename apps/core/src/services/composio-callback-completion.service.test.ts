import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PROJECT_AD_PROVIDERS,
  type ProjectAdProvider,
} from "@/config/ads-providers";
import {
  PROJECT_SOCIAL_PROVIDERS,
  type ProjectSocialProvider,
} from "@/config/social-providers";

const {
  completeComposioAuthMock,
  getComposioConnectedAccountMock,
  socialConnectionIntentFindUniqueMock,
  socialConnectionIntentUpdateManyMock,
} = vi.hoisted(() => ({
  completeComposioAuthMock: vi.fn(),
  getComposioConnectedAccountMock: vi.fn(),
  socialConnectionIntentFindUniqueMock: vi.fn(),
  socialConnectionIntentUpdateManyMock: vi.fn(),
}));

vi.mock("@/clients/composio.client", () => ({
  completeComposioAuth: completeComposioAuthMock,
  getComposioConnectedAccount: getComposioConnectedAccountMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSocialConnectionIntent: {
      findUnique: socialConnectionIntentFindUniqueMock,
      updateMany: socialConnectionIntentUpdateManyMock,
    },
  },
}));

describe("completeComposioCallback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T10:00:00.000Z"));
    completeComposioAuthMock.mockResolvedValue({
      connectedAccountId: "ca_123",
      toolkitSlug: "twitter",
    });
    getComposioConnectedAccountMock.mockResolvedValue({
      id: "ca_123",
      toolkitSlug: "twitter",
      authConfigId: "ac_x",
      connectorUserId: "sokosumi:user:user_123",
    });
    socialConnectionIntentUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it.each(Object.keys(PROJECT_SOCIAL_PROVIDERS) as ProjectSocialProvider[])(
    "redeems the pinned %s callback",
    async (provider) => {
      socialConnectionIntentFindUniqueMock.mockResolvedValue({
        initiatingUserId: "user_123",
        provider,
        authConfigId: `ac_${provider}`,
        callbackRedeemedAt: null,
        expiresAt: new Date("2026-09-03T10:15:00.000Z"),
        project: { closingAt: null, closedAt: null },
      });
      completeComposioAuthMock.mockResolvedValue({
        connectedAccountId: "ca_123",
        toolkitSlug: PROJECT_SOCIAL_PROVIDERS[provider].toolkitSlug,
      });
      getComposioConnectedAccountMock.mockResolvedValue({
        id: "ca_123",
        toolkitSlug: PROJECT_SOCIAL_PROVIDERS[provider].toolkitSlug,
        authConfigId: `ac_${provider}`,
        connectorUserId: "sokosumi:user:user_123",
      });
      const { completeComposioCallback } = await import(
        "./composio-callback-completion.service"
      );
      await expect(
        completeComposioCallback({
          connectionId: "ca_123",
          sessionUri: "single-use",
          userId: "user_123",
        }),
      ).resolves.toBeUndefined();
      expect(socialConnectionIntentUpdateManyMock).toHaveBeenCalledWith({
        where: expect.objectContaining({
          provider,
          authConfigId: `ac_${provider}`,
          initiatingUserId: "user_123",
          callbackRedeemedAt: null,
        }),
        data: { callbackRedeemedAt: new Date("2026-09-03T10:00:00.000Z") },
      });
    },
  );

  it.each(Object.keys(PROJECT_AD_PROVIDERS) as ProjectAdProvider[])(
    "redeems the pinned %s ads callback",
    async (provider) => {
      const { toolkitSlug } = PROJECT_AD_PROVIDERS[provider];
      socialConnectionIntentFindUniqueMock.mockResolvedValue({
        initiatingUserId: "user_123",
        provider,
        authConfigId: `ac_${provider}`,
        callbackRedeemedAt: null,
        expiresAt: new Date("2026-09-03T10:15:00.000Z"),
        project: { closingAt: null, closedAt: null },
      });
      completeComposioAuthMock.mockResolvedValue({
        connectedAccountId: "ca_123",
        toolkitSlug,
      });
      getComposioConnectedAccountMock.mockResolvedValue({
        id: "ca_123",
        toolkitSlug,
        authConfigId: `ac_${provider}`,
        connectorUserId: "sokosumi:user:user_123",
      });
      const { completeComposioCallback } = await import(
        "./composio-callback-completion.service"
      );
      await expect(
        completeComposioCallback({
          connectionId: "ca_123",
          sessionUri: "single-use",
          userId: "user_123",
        }),
      ).resolves.toBeUndefined();
      expect(socialConnectionIntentUpdateManyMock).toHaveBeenCalledWith({
        where: expect.objectContaining({ provider }),
        data: { callbackRedeemedAt: expect.any(Date) },
      });
    },
  );

  it("rejects an ads callback whose account is another toolkit", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue({
      initiatingUserId: "user_123",
      provider: "google_ads",
      authConfigId: "ac_google_ads",
      callbackRedeemedAt: null,
      expiresAt: new Date("2026-09-03T10:15:00.000Z"),
      project: { closingAt: null, closedAt: null },
    });
    completeComposioAuthMock.mockResolvedValue({
      connectedAccountId: "ca_123",
      toolkitSlug: "metaads",
    });
    const { completeComposioCallback } = await import(
      "./composio-callback-completion.service"
    );
    await expect(
      completeComposioCallback({
        connectionId: "ca_123",
        sessionUri: "single-use",
        userId: "user_123",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(socialConnectionIntentUpdateManyMock).not.toHaveBeenCalled();
  });

  it.each([
    { toolkitSlug: "instagram" },
    { authConfigId: "ac_other" },
    { connectorUserId: "sokosumi:user:user_other" },
    { id: "ca_other" },
  ])(
    "rejects account metadata differing from the pinned callback: %j",
    async (changed) => {
      socialConnectionIntentFindUniqueMock.mockResolvedValue({
        initiatingUserId: "user_123",
        provider: "x",
        authConfigId: "ac_x",
        callbackRedeemedAt: null,
        expiresAt: new Date("2026-09-03T10:15:00.000Z"),
        project: { closingAt: null, closedAt: null },
      });
      getComposioConnectedAccountMock.mockResolvedValue({
        id: "ca_123",
        toolkitSlug: "twitter",
        authConfigId: "ac_x",
        connectorUserId: "sokosumi:user:user_123",
        ...changed,
      });
      const { completeComposioCallback } = await import(
        "./composio-callback-completion.service"
      );
      await expect(
        completeComposioCallback({
          connectionId: "ca_123",
          sessionUri: "single-use",
          userId: "user_123",
        }),
      ).rejects.toThrow("Unknown or expired connection");
      expect(socialConnectionIntentUpdateManyMock).not.toHaveBeenCalled();
    },
  );

  it("rejects a callback toolkit from another provider", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue({
      initiatingUserId: "user_123",
      provider: "instagram",
      authConfigId: "ac_instagram",
      callbackRedeemedAt: null,
      expiresAt: new Date("2026-09-03T10:15:00.000Z"),
      project: { closingAt: null, closedAt: null },
    });
    const { completeComposioCallback } = await import(
      "./composio-callback-completion.service"
    );
    await expect(
      completeComposioCallback({
        connectionId: "ca_123",
        sessionUri: "single-use",
        userId: "user_123",
      }),
    ).rejects.toThrow("Unknown or expired connection");
    expect(getComposioConnectedAccountMock).not.toHaveBeenCalled();
    expect(socialConnectionIntentUpdateManyMock).not.toHaveBeenCalled();
  });

  it.each([
    { provider: "unsupported" },
    { callbackRedeemedAt: new Date("2026-09-03T10:00:00.000Z") },
    { expiresAt: new Date("2026-09-03T09:59:59.000Z") },
  ])(
    "rejects invalid local callback state before spending its session: %j",
    async (changed) => {
      socialConnectionIntentFindUniqueMock.mockResolvedValue({
        initiatingUserId: "user_123",
        provider: "x",
        authConfigId: "ac_x",
        callbackRedeemedAt: null,
        expiresAt: new Date("2026-09-03T10:15:00.000Z"),
        project: { closingAt: null, closedAt: null },
        ...changed,
      });
      const { completeComposioCallback } = await import(
        "./composio-callback-completion.service"
      );
      await expect(
        completeComposioCallback({
          connectionId: "ca_123",
          sessionUri: "single-use",
          userId: "user_123",
        }),
      ).rejects.toThrow("Unknown or expired connection");
      expect(completeComposioAuthMock).not.toHaveBeenCalled();
    },
  );

  it("redeems a live Project social callback for its initiating human", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue({
      connectionId: "ca_123",
      initiatingUserId: "user_123",
      provider: "x",
      authConfigId: "ac_x",
      callbackRedeemedAt: null,
      project: { closingAt: null, closedAt: null },
      expiresAt: new Date("2026-09-03T10:15:00.000Z"),
    });
    const { completeComposioCallback } = await import(
      "./composio-callback-completion.service"
    );

    await expect(
      completeComposioCallback({
        connectionId: "ca_123",
        sessionUri: "https://backend.composio.dev/session/single-use",
        userId: "user_123",
      }),
    ).resolves.toBeUndefined();

    expect(completeComposioAuthMock).toHaveBeenCalledWith({
      sessionUri: "https://backend.composio.dev/session/single-use",
      userId: "sokosumi:user:user_123",
    });
    expect(socialConnectionIntentUpdateManyMock).toHaveBeenCalledWith({
      where: {
        connectionId: "ca_123",
        initiatingUserId: "user_123",
        provider: "x",
        authConfigId: "ac_x",
        callbackRedeemedAt: null,
        expiresAt: { gt: new Date("2026-09-03T10:00:00.000Z") },
        project: { closingAt: null, closedAt: null },
      },
      data: {
        callbackRedeemedAt: new Date("2026-09-03T10:00:00.000Z"),
      },
    });
  });

  it("rejects a Project social callback from another human before spending its session", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue({
      connectionId: "ca_123",
      initiatingUserId: "user_123",
      provider: "x",
      authConfigId: "ac_x",
      callbackRedeemedAt: null,
      project: { closingAt: null, closedAt: null },
      expiresAt: new Date("2026-09-03T10:15:00.000Z"),
    });
    const { completeComposioCallback } = await import(
      "./composio-callback-completion.service"
    );

    await expect(
      completeComposioCallback({
        connectionId: "ca_123",
        sessionUri: "https://backend.composio.dev/session/single-use",
        userId: "user_other",
      }),
    ).rejects.toThrow("Unknown or expired connection");
    expect(completeComposioAuthMock).not.toHaveBeenCalled();
  });

  it("rejects completion when Composio returns a different connected account", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue({
      connectionId: "ca_123",
      initiatingUserId: "user_123",
      provider: "x",
      authConfigId: "ac_x",
      callbackRedeemedAt: null,
      project: { closingAt: null, closedAt: null },
      expiresAt: new Date("2026-09-03T10:15:00.000Z"),
    });
    completeComposioAuthMock.mockResolvedValue({
      connectedAccountId: "ca_other",
      toolkitSlug: "twitter",
    });
    const { completeComposioCallback } = await import(
      "./composio-callback-completion.service"
    );

    await expect(
      completeComposioCallback({
        connectionId: "ca_123",
        sessionUri: "https://backend.composio.dev/session/single-use",
        userId: "user_123",
      }),
    ).rejects.toThrow("Unknown or expired connection");
  });

  it("rejects completion when no Project social intent exists", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(null);
    const { completeComposioCallback } = await import(
      "./composio-callback-completion.service"
    );

    await expect(
      completeComposioCallback({
        connectionId: "ca_123",
        sessionUri: "https://backend.composio.dev/session/single-use",
        userId: "user_123",
      }),
    ).rejects.toThrow("Unknown or expired connection");
    expect(completeComposioAuthMock).not.toHaveBeenCalled();
  });

  it.each(["closingAt", "closedAt"])(
    "rejects a callback for a terminal Project (%s)",
    async (field) => {
      socialConnectionIntentFindUniqueMock.mockResolvedValue({
        initiatingUserId: "user_123",
        provider: "x",
        authConfigId: "ac_x",
        callbackRedeemedAt: null,
        expiresAt: new Date("2026-09-03T10:15:00Z"),
        project: { closingAt: null, closedAt: null, [field]: new Date() },
      });
      const { completeComposioCallback } = await import(
        "./composio-callback-completion.service"
      );
      await expect(
        completeComposioCallback({
          connectionId: "ca_123",
          sessionUri: "https://backend.composio.dev/session/single-use",
          userId: "user_123",
        }),
      ).rejects.toThrow("Unknown or expired connection");
      expect(completeComposioAuthMock).not.toHaveBeenCalled();
    },
  );

  it("rejects redemption when the intent is consumed while complete_auth is in flight", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue({
      initiatingUserId: "user_123",
      provider: "x",
      authConfigId: "ac_x",
      callbackRedeemedAt: null,
      expiresAt: new Date("2026-09-03T10:15:00Z"),
      project: { closingAt: null, closedAt: null },
    });
    socialConnectionIntentUpdateManyMock.mockResolvedValue({ count: 0 });
    const { completeComposioCallback } = await import(
      "./composio-callback-completion.service"
    );

    await expect(
      completeComposioCallback({
        connectionId: "ca_123",
        sessionUri: "https://backend.composio.dev/session/single-use",
        userId: "user_123",
      }),
    ).rejects.toThrow("Unknown or expired connection");
  });
});
