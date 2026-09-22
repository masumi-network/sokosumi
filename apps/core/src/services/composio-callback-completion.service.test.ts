import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  socialConnectionFindFirstMock,
  completeComposioAuthMock,
  hermesPendingConnectionFindUniqueMock,
  socialConnectionIntentFindUniqueMock,
} = vi.hoisted(() => ({
  socialConnectionFindFirstMock: vi.fn(),
  completeComposioAuthMock: vi.fn(),
  hermesPendingConnectionFindUniqueMock: vi.fn(),
  socialConnectionIntentFindUniqueMock: vi.fn(),
}));

vi.mock("@/clients/composio.client", () => ({
  completeComposioAuth: completeComposioAuthMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSocialConnection: { findFirst: socialConnectionFindFirstMock },
    hermesPendingConnection: {
      findUnique: hermesPendingConnectionFindUniqueMock,
    },
    projectSocialConnectionIntent: {
      findUnique: socialConnectionIntentFindUniqueMock,
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
  });

  it("redeems a live Project social callback for its initiating human", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue({
      connectionId: "ca_123",
      initiatingUserId: "user_123",
      provider: "x",
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
  });

  it("rejects a Project social callback from another human before spending its session", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue({
      connectionId: "ca_123",
      initiatingUserId: "user_123",
      provider: "x",
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

  it("keeps Hermes OAuth compatible by redeeming its pending connection with the Hermes user id", async () => {
    hermesPendingConnectionFindUniqueMock.mockResolvedValue({
      userId: "user_123",
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
      userId: "user_123",
    });
  });
  it.each(["closingAt", "closedAt"])(
    "rejects a callback for a terminal Project (%s)",
    async (field) => {
      socialConnectionIntentFindUniqueMock.mockResolvedValue({
        initiatingUserId: "user_123",
        provider: "x",
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

  it.each([true, false])(
    "handles concurrent intent consumption without revoking a finalized account (live=%s)",
    async (live) => {
      socialConnectionIntentFindUniqueMock
        .mockResolvedValueOnce({
          initiatingUserId: "user_123",
          provider: "x",
          expiresAt: new Date("2026-09-03T10:15:00Z"),
          project: { closingAt: null, closedAt: null },
        })
        .mockResolvedValueOnce(null);
      socialConnectionFindFirstMock.mockResolvedValue(
        live ? { id: "social_123" } : null,
      );
      const { completeComposioCallback } = await import(
        "./composio-callback-completion.service"
      );
      const result = completeComposioCallback({
        connectionId: "ca_123",
        sessionUri: "https://backend.composio.dev/session/single-use",
        userId: "user_123",
      });
      if (live) await expect(result).resolves.toBeUndefined();
      else
        await expect(result).rejects.toThrow("Unknown or expired connection");
    },
  );
});
