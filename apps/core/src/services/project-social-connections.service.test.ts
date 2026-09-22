import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  deleteProjectXConnectionIntentMock,
  getConnectedXIdentityMock,
  lockCalendarScopeMock,
  getEnvMock,
  getProjectXConnectedAccountMock,
  getWebAppBaseUrlMock,
  initiateProjectXConnectionMock,
  projectFindFirstMock,
  revokeProjectXConnectionMock,
  socialConnectionAuditCreateMock,
  socialConnectionAuditUpdateMock,
  socialConnectionCreateMock,
  socialConnectionFindFirstMock,
  socialConnectionFindManyMock,
  socialConnectionFindUniqueMock,
  socialConnectionIntentCreateMock,
  socialConnectionIntentDeleteMock,
  socialConnectionIntentFindUniqueMock,
  socialConnectionIntentFindUniqueInTransactionMock,
  socialConnectionUpdateMock,
  transactionMock,
} = vi.hoisted(() => ({
  deleteProjectXConnectionIntentMock: vi.fn(),
  getConnectedXIdentityMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  getEnvMock: vi.fn(),
  getProjectXConnectedAccountMock: vi.fn(),
  getWebAppBaseUrlMock: vi.fn(),
  initiateProjectXConnectionMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  revokeProjectXConnectionMock: vi.fn(),
  socialConnectionAuditCreateMock: vi.fn(),
  socialConnectionAuditUpdateMock: vi.fn(),
  socialConnectionCreateMock: vi.fn(),
  socialConnectionFindFirstMock: vi.fn(),
  socialConnectionFindManyMock: vi.fn(),
  socialConnectionFindUniqueMock: vi.fn(),
  socialConnectionIntentCreateMock: vi.fn(),
  socialConnectionIntentDeleteMock: vi.fn(),
  socialConnectionIntentFindUniqueMock: vi.fn(),
  socialConnectionIntentFindUniqueInTransactionMock: vi.fn(),
  socialConnectionUpdateMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/clients/composio.client", () => ({
  deleteProjectXConnectionIntent: deleteProjectXConnectionIntentMock,
  getConnectedXIdentity: getConnectedXIdentityMock,
  getProjectXConnectedAccount: getProjectXConnectedAccountMock,
  initiateProjectXConnection: initiateProjectXConnectionMock,
  revokeProjectXConnection: revokeProjectXConnectionMock,
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
  getWebAppBaseUrl: getWebAppBaseUrlMock,
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
}));

const transactionClient = {
  project: { findFirst: projectFindFirstMock },
  projectSocialConnection: {
    create: socialConnectionCreateMock,
    findFirst: socialConnectionFindFirstMock,
    findUnique: socialConnectionFindUniqueMock,
    findMany: socialConnectionFindManyMock,
    update: socialConnectionUpdateMock,
  },
  projectSocialConnectionAudit: {
    create: socialConnectionAuditCreateMock,
    findFirst: vi.fn(),
  },
  projectSocialConnectionIntent: {
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    create: socialConnectionIntentCreateMock,
    delete: socialConnectionIntentDeleteMock,
    findUnique: socialConnectionIntentFindUniqueInTransactionMock,
  },
};

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    project: { findFirst: projectFindFirstMock },
    projectSocialConnection: {
      findFirst: socialConnectionFindFirstMock,
      findMany: socialConnectionFindManyMock,
    },
    projectSocialConnectionAudit: {
      update: socialConnectionAuditUpdateMock,
    },
    projectSocialConnectionIntent: {
      deleteMany: socialConnectionIntentDeleteMock,
      create: socialConnectionIntentCreateMock,
      findUnique: socialConnectionIntentFindUniqueMock,
    },
  },
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "user_123";
const CONNECTION_ID = "ca_123";
const SOCIAL_CONNECTION_ID = "33333333-3333-4333-8333-333333333333";

const socialConnection = {
  id: SOCIAL_CONNECTION_ID,
  projectId: PROJECT_ID,
  provider: "x",
  externalAccountId: "123",
  externalHandle: "sokosumi",
  composioConnectedAccountId: "ca_old",
  status: "reauthorization_required",
  activeExternalAccountKey: "x:123",
  connectorUserId: "sokosumi:user:user_previous",
  connectedAt: new Date("2026-09-03T10:00:00.000Z"),
  disconnectedAt: null,
  createdAt: new Date("2026-09-03T10:00:00.000Z"),
  updatedAt: new Date("2026-09-03T10:00:00.000Z"),
};

function createIntent(action: "connect" | "reconnect" | "replace") {
  return {
    connectionId: CONNECTION_ID,
    projectId: PROJECT_ID,
    initiatingUserId: USER_ID,
    provider: "x",
    action,
    socialConnectionId: action === "connect" ? null : SOCIAL_CONNECTION_ID,
    authConfigId: "ac_x",
    expiresAt: new Date("2026-09-03T10:15:00.000Z"),
    createdAt: new Date("2026-09-03T10:00:00.000Z"),
  };
}

describe("project social connections service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    lockCalendarScopeMock.mockResolvedValue(true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T10:00:00.000Z"));
    getEnvMock.mockReturnValue({ COMPOSIO_X_AUTH_CONFIG_ID: "ac_x" });
    getWebAppBaseUrlMock.mockReturnValue("https://app.sokosumi.com");
    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID });
    initiateProjectXConnectionMock.mockResolvedValue({
      connectionId: CONNECTION_ID,
      redirectUrl: "https://connect.composio.dev/link-token",
    });
    getProjectXConnectedAccountMock.mockResolvedValue({
      id: CONNECTION_ID,
      status: "ACTIVE",
      toolkitSlug: "twitter",
      authConfigId: "ac_x",
      connectorUserId: `sokosumi:user:${USER_ID}`,
    });
    getConnectedXIdentityMock.mockResolvedValue({
      id: "123",
      handle: "sokosumi",
    });
    socialConnectionCreateMock.mockResolvedValue({
      ...socialConnection,
      composioConnectedAccountId: CONNECTION_ID,
      status: "active",
    });
    socialConnectionAuditCreateMock.mockResolvedValue({ id: "audit_123" });
    socialConnectionUpdateMock.mockResolvedValue(socialConnection);
    socialConnectionFindUniqueMock.mockResolvedValue(socialConnection);
    socialConnectionIntentDeleteMock.mockResolvedValue({});
    socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(
      createIntent("connect"),
    );
    socialConnectionAuditUpdateMock.mockResolvedValue({});
    transactionMock.mockImplementation(
      async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    );
  });

  it.each(["closingAt", "closedAt"])(
    "rejects initiation and finalization when %s is set",
    async (field) => {
      projectFindFirstMock.mockResolvedValue({
        id: PROJECT_ID,
        [field]: new Date(),
      });
      const {
        initiateProjectSocialConnection,
        finalizeProjectSocialConnection,
      } = await import("./project-social-connections.service");
      await expect(
        initiateProjectSocialConnection({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          provider: "x",
          action: "connect",
        }),
      ).rejects.toThrow("closing or closed");
      await expect(
        finalizeProjectSocialConnection({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          connectionId: CONNECTION_ID,
        }),
      ).rejects.toThrow("closing or closed");
      expect(initiateProjectXConnectionMock).not.toHaveBeenCalled();
      expect(socialConnectionCreateMock).not.toHaveBeenCalled();
    },
  );

  it("revokes an unreturned link when close wins during provider initiation", async () => {
    initiateProjectXConnectionMock.mockImplementation(async () => {
      projectFindFirstMock.mockResolvedValue({
        id: PROJECT_ID,
        closingAt: new Date(),
      });
      return {
        connectionId: CONNECTION_ID,
        redirectUrl: "https://connect.composio.dev/link-token",
      };
    });
    const { initiateProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );
    await expect(
      initiateProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        provider: "x",
        action: "connect",
      }),
    ).rejects.toThrow("closing or closed");
    expect(socialConnectionIntentCreateMock).not.toHaveBeenCalled();
    expect(deleteProjectXConnectionIntentMock).toHaveBeenCalledWith({
      connectedAccountId: CONNECTION_ID,
    });
  });

  it("does not finalize when close wins during identity lookup", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("connect"),
    );
    getConnectedXIdentityMock.mockImplementation(async () => {
      projectFindFirstMock.mockResolvedValue({
        id: PROJECT_ID,
        closingAt: new Date(),
      });
      return { id: "123", handle: "sokosumi" };
    });
    const { finalizeProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );
    await expect(
      finalizeProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        connectionId: CONNECTION_ID,
      }),
    ).rejects.toThrow("closing or closed");
    expect(socialConnectionCreateMock).not.toHaveBeenCalled();
    expect(socialConnectionIntentDeleteMock).not.toHaveBeenCalled();
  });

  it("creates one expiring intent after validating the scoped Project", async () => {
    const { initiateProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await expect(
      initiateProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        provider: "x",
        action: "connect",
      }),
    ).resolves.toEqual({
      connectionId: CONNECTION_ID,
      redirectUrl: "https://connect.composio.dev/link-token",
    });

    expect(projectFindFirstMock).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      select: { id: true, closingAt: true, closedAt: true },
    });
    expect(initiateProjectXConnectionMock).toHaveBeenCalledWith({
      authConfigId: "ac_x",
      connectorUserId: "sokosumi:user:user_123",
      executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
      callbackUrl: "https://app.sokosumi.com/composio/callback",
    });
    expect(socialConnectionIntentCreateMock).toHaveBeenCalledWith({
      data: {
        connectionId: CONNECTION_ID,
        projectId: PROJECT_ID,
        initiatingUserId: USER_ID,
        provider: "x",
        action: "connect",
        socialConnectionId: null,
        authConfigId: "ac_x",
        expiresAt: new Date("2026-09-03T10:15:00.000Z"),
      },
    });
  });

  it("rejects a callback from a different user or project", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("connect"),
    );
    const { finalizeProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await expect(
      finalizeProjectSocialConnection({
        projectId: "44444444-4444-4444-8444-444444444444",
        workspaceId: WORKSPACE_ID,
        userId: "user_other",
        connectionId: CONNECTION_ID,
      }),
    ).rejects.toThrow("Unknown or expired connection");

    expect(getProjectXConnectedAccountMock).not.toHaveBeenCalled();
    expect(socialConnectionIntentDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects a completed account without the initiating connector identity", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("connect"),
    );
    getProjectXConnectedAccountMock.mockResolvedValue({
      id: CONNECTION_ID,
      status: "ACTIVE",
      toolkitSlug: "twitter",
      authConfigId: "ac_x",
      connectorUserId: null,
    });
    const { finalizeProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await expect(
      finalizeProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        connectionId: CONNECTION_ID,
      }),
    ).rejects.toThrow("Unknown or expired connection");

    expect(getConnectedXIdentityMock).not.toHaveBeenCalled();
    expect(socialConnectionCreateMock).not.toHaveBeenCalled();
  });

  it("blocks a duplicate active provider/account in one Project", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("connect"),
    );
    socialConnectionFindFirstMock.mockResolvedValue({
      ...socialConnection,
      status: "active",
    });
    const { finalizeProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await expect(
      finalizeProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        connectionId: CONNECTION_ID,
      }),
    ).rejects.toThrow("already connected");

    expect(socialConnectionCreateMock).not.toHaveBeenCalled();
    expect(socialConnectionIntentDeleteMock).not.toHaveBeenCalled();
  });

  it("maps a finalization write race to a retryable conflict", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("connect"),
    );
    transactionMock.mockRejectedValue(
      Object.assign(new Error("Transaction failed"), { code: "P2034" }),
    );
    const { finalizeProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    const finalization = finalizeProjectSocialConnection({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      connectionId: CONNECTION_ID,
    });
    const assertion = expect(finalization).rejects.toMatchObject({
      status: 409,
      message: "Project social connection changed. Please retry.",
      cause: { kind: "concurrency_conflict" },
    });
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("maps the database uniqueness safety net to a duplicate-account conflict", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("connect"),
    );
    transactionMock.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    const { finalizeProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await expect(
      finalizeProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        connectionId: CONNECTION_ID,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "This X account is already connected to the Project",
    });
  });

  it("uses the auth config captured when the social intent was initiated", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("connect"),
    );
    socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(
      createIntent("connect"),
    );
    getEnvMock.mockReturnValue({ COMPOSIO_X_AUTH_CONFIG_ID: "ac_changed" });
    getProjectXConnectedAccountMock.mockResolvedValue({
      id: CONNECTION_ID,
      status: "ACTIVE",
      toolkitSlug: "twitter",
      authConfigId: "ac_x",
      connectorUserId: `sokosumi:user:${USER_ID}`,
    });
    const { finalizeProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await expect(
      finalizeProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        connectionId: CONNECTION_ID,
      }),
    ).resolves.toMatchObject({ status: "active" });
  });

  it("rejects a one-use intent consumed after the callback identity lookup", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("connect"),
    );
    socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(null);
    const { finalizeProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await expect(
      finalizeProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        connectionId: CONNECTION_ID,
      }),
    ).rejects.toThrow("Unknown or expired connection");
    expect(socialConnectionCreateMock).not.toHaveBeenCalled();
    expect(socialConnectionIntentDeleteMock).not.toHaveBeenCalled();
  });

  it("allows reconnect only for a connection that requires reauthorization", async () => {
    socialConnectionFindFirstMock.mockResolvedValue({
      ...socialConnection,
      status: "active",
    });
    const { initiateProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await expect(
      initiateProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        provider: "x",
        action: "reconnect",
        socialConnectionId: SOCIAL_CONNECTION_ID,
      }),
    ).rejects.toThrow("requires reauthorization");
    expect(initiateProjectXConnectionMock).not.toHaveBeenCalled();
  });

  it("requires a new connect instead of reconnecting a disconnected row", async () => {
    socialConnectionFindFirstMock.mockResolvedValue({
      ...socialConnection,
      status: "disconnected",
    });
    const { initiateProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await expect(
      initiateProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        provider: "x",
        action: "reconnect",
        socialConnectionId: SOCIAL_CONNECTION_ID,
      }),
    ).rejects.toThrow("requires a new connection");
  });

  it("rejects replacement of a disconnected row", async () => {
    socialConnectionFindFirstMock.mockResolvedValue({
      ...socialConnection,
      status: "disconnected",
    });
    const { initiateProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await expect(
      initiateProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        provider: "x",
        action: "replace",
        socialConnectionId: SOCIAL_CONNECTION_ID,
      }),
    ).rejects.toThrow("live connection");

    expect(initiateProjectXConnectionMock).not.toHaveBeenCalled();
    expect(socialConnectionUpdateMock).not.toHaveBeenCalled();
  });

  it("locally blocks and audits a replacement target before returning its OAuth link", async () => {
    const target = { ...socialConnection, status: "active" };
    socialConnectionFindFirstMock
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(null);
    const { initiateProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await expect(
      initiateProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        provider: "x",
        action: "replace",
        socialConnectionId: SOCIAL_CONNECTION_ID,
      }),
    ).resolves.toEqual({
      connectionId: CONNECTION_ID,
      redirectUrl: "https://connect.composio.dev/link-token",
    });

    expect(socialConnectionUpdateMock).toHaveBeenCalledWith({
      where: { id: SOCIAL_CONNECTION_ID },
      data: {
        status: "disconnected",
        activeExternalAccountKey: null,
        disconnectedAt: new Date("2026-09-03T10:00:00.000Z"),
      },
    });
    expect(socialConnectionAuditCreateMock).toHaveBeenCalledWith({
      data: {
        projectSocialConnectionId: SOCIAL_CONNECTION_ID,
        action: "replace_retire",
        actorId: USER_ID,
        externalAccountId: "123",
        externalHandle: "sokosumi",
        providerOutcome: "local_disconnect",
      },
    });
    expect(socialConnectionIntentCreateMock).toHaveBeenCalledWith({
      data: {
        connectionId: CONNECTION_ID,
        projectId: PROJECT_ID,
        initiatingUserId: USER_ID,
        provider: "x",
        action: "replace",
        socialConnectionId: SOCIAL_CONNECTION_ID,
        authConfigId: "ac_x",
        expiresAt: new Date("2026-09-03T10:15:00.000Z"),
      },
    });
    expect(revokeProjectXConnectionMock).toHaveBeenCalledWith({
      connectedAccountId: "ca_old",
    });
    expect(socialConnectionAuditUpdateMock).toHaveBeenCalledWith({
      where: { id: "audit_123" },
      data: { providerOutcome: "revoked" },
    });
    expect(socialConnectionUpdateMock.mock.invocationCallOrder[0]).toBeLessThan(
      socialConnectionAuditCreateMock.mock.invocationCallOrder[0]!,
    );
    expect(
      socialConnectionAuditCreateMock.mock.invocationCallOrder[0],
    ).toBeLessThan(revokeProjectXConnectionMock.mock.invocationCallOrder[0]!);
    expect(
      revokeProjectXConnectionMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      socialConnectionAuditUpdateMock.mock.invocationCallOrder[0]!,
    );
    expect(
      socialConnectionAuditUpdateMock.mock.invocationCallOrder[0],
    ).toBeLessThan(initiateProjectXConnectionMock.mock.invocationCallOrder[0]!);
    expect(
      initiateProjectXConnectionMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      socialConnectionIntentCreateMock.mock.invocationCallOrder[0]!,
    );
  });

  it("reconnects only the existing X identity", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("reconnect"),
    );
    socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(
      createIntent("reconnect"),
    );
    socialConnectionFindFirstMock.mockResolvedValue(socialConnection);
    socialConnectionUpdateMock.mockResolvedValue({
      ...socialConnection,
      composioConnectedAccountId: CONNECTION_ID,
      connectorUserId: `sokosumi:user:${USER_ID}`,
      status: "active",
      connectedAt: new Date("2026-09-03T10:00:00.000Z"),
    });
    const { finalizeProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await expect(
      finalizeProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        connectionId: CONNECTION_ID,
      }),
    ).resolves.toMatchObject({
      id: SOCIAL_CONNECTION_ID,
      provider: "x",
      externalHandle: "sokosumi",
      status: "active",
    });

    expect(socialConnectionUpdateMock).toHaveBeenCalledWith({
      where: { id: SOCIAL_CONNECTION_ID },
      data: {
        composioConnectedAccountId: CONNECTION_ID,
        connectorUserId: `sokosumi:user:${USER_ID}`,
        externalHandle: "sokosumi",
        status: "active",
        activeExternalAccountKey: "x:123",
        connectedAt: new Date("2026-09-03T10:00:00.000Z"),
        disconnectedAt: null,
      },
    });
    expect(socialConnectionIntentDeleteMock).toHaveBeenCalledWith({
      where: { connectionId: CONNECTION_ID },
    });
  });

  it("rejects a reconnect to a different X identity", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("reconnect"),
    );
    socialConnectionFindFirstMock.mockResolvedValue(socialConnection);
    socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(
      createIntent("reconnect"),
    );
    getConnectedXIdentityMock.mockResolvedValue({
      id: "999",
      handle: "other-account",
    });
    const { finalizeProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await expect(
      finalizeProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        connectionId: CONNECTION_ID,
      }),
    ).rejects.toThrow("must match the existing account");

    expect(socialConnectionUpdateMock).not.toHaveBeenCalled();
    expect(socialConnectionIntentDeleteMock).not.toHaveBeenCalled();
  });

  it("retires and revokes the outgoing account when reconnect activates a replacement credential", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("reconnect"),
    );
    socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(
      createIntent("reconnect"),
    );
    socialConnectionFindFirstMock
      .mockResolvedValueOnce(socialConnection)
      .mockResolvedValueOnce(null);
    socialConnectionUpdateMock.mockResolvedValue({
      ...socialConnection,
      composioConnectedAccountId: CONNECTION_ID,
      connectorUserId: `sokosumi:user:${USER_ID}`,
      status: "active",
    });
    socialConnectionAuditCreateMock
      .mockResolvedValueOnce({ id: "audit_retire" })
      .mockResolvedValueOnce({ id: "audit_reconnect" });
    const { finalizeProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await expect(
      finalizeProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        connectionId: CONNECTION_ID,
      }),
    ).resolves.toMatchObject({ status: "active" });

    expect(socialConnectionAuditCreateMock).toHaveBeenCalledWith({
      data: {
        projectSocialConnectionId: SOCIAL_CONNECTION_ID,
        action: "reconnect_retire",
        actorId: USER_ID,
        externalAccountId: "123",
        externalHandle: "sokosumi",
        providerOutcome: "local_disconnect",
      },
    });
    expect(revokeProjectXConnectionMock).toHaveBeenCalledWith({
      connectedAccountId: "ca_old",
    });
    expect(socialConnectionAuditUpdateMock).toHaveBeenCalledWith({
      where: { id: "audit_retire" },
      data: { providerOutcome: "revoked" },
    });
  });

  it("activates a replacement against the locally retired target", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("replace"),
    );
    socialConnectionFindFirstMock.mockImplementation(
      (args: { where?: { NOT?: { id: string } } }) =>
        args.where?.NOT
          ? null
          : { ...socialConnection, status: "disconnected" },
    );
    socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(
      createIntent("replace"),
    );
    const { finalizeProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await finalizeProjectSocialConnection({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      connectionId: CONNECTION_ID,
    });

    expect(socialConnectionUpdateMock).not.toHaveBeenCalled();
    expect(socialConnectionCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: PROJECT_ID,
        externalAccountId: "123",
        status: "active",
        activeExternalAccountKey: "x:123",
      }),
    });
  });

  it("keeps an outgoing account when another Project requires reauthorization", async () => {
    const target = { ...socialConnection, status: "active" };
    socialConnectionFindFirstMock
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(target)
      .mockImplementationOnce(() => ({ id: "shared-connection" }));
    const { initiateProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await initiateProjectSocialConnection({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      provider: "x",
      action: "replace",
      socialConnectionId: SOCIAL_CONNECTION_ID,
    });

    expect(revokeProjectXConnectionMock).not.toHaveBeenCalled();
    expect(socialConnectionFindFirstMock).toHaveBeenLastCalledWith({
      where: {
        composioConnectedAccountId: "ca_old",
        status: { not: "disconnected" },
        NOT: { id: SOCIAL_CONNECTION_ID },
      },
      select: { id: true },
    });
    expect(socialConnectionAuditUpdateMock).toHaveBeenCalledWith({
      where: { id: "audit_123" },
      data: { providerOutcome: "revocation_skipped_shared" },
    });
  });

  it("keeps a connection locally blocked and audited when provider revocation fails", async () => {
    socialConnectionFindFirstMock.mockResolvedValueOnce({
      ...socialConnection,
      status: "active",
      composioConnectedAccountId: CONNECTION_ID,
    });
    socialConnectionFindFirstMock.mockResolvedValueOnce(null);
    socialConnectionUpdateMock.mockResolvedValue({
      ...socialConnection,
      status: "disconnected",
      activeExternalAccountKey: null,
    });
    revokeProjectXConnectionMock.mockRejectedValue(
      new Error("provider failed"),
    );
    const { disconnectProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await expect(
      disconnectProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        socialConnectionId: SOCIAL_CONNECTION_ID,
      }),
    ).resolves.toMatchObject({ providerRevocation: "failed" });

    expect(socialConnectionUpdateMock).toHaveBeenCalledWith({
      where: { id: SOCIAL_CONNECTION_ID },
      data: {
        status: "disconnected",
        activeExternalAccountKey: null,
        disconnectedAt: new Date("2026-09-03T10:00:00.000Z"),
      },
    });
    expect(socialConnectionAuditUpdateMock).toHaveBeenCalledWith({
      where: { id: "audit_123" },
      data: { providerOutcome: "revocation_failed" },
    });
  });

  it("lists only non-disconnected Project connections without provider references", async () => {
    socialConnectionFindManyMock.mockResolvedValue([
      { ...socialConnection, status: "active" },
    ]);
    getProjectXConnectedAccountMock.mockResolvedValue({
      id: "ca_old",
      status: "ACTIVE",
      toolkitSlug: "twitter",
      authConfigId: "ac_x",
      connectorUserId: `sokosumi:user:${USER_ID}`,
    });
    const { listProjectSocialConnections } = await import(
      "./project-social-connections.service"
    );

    await expect(
      listProjectSocialConnections({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      }),
    ).resolves.toEqual([
      {
        id: SOCIAL_CONNECTION_ID,
        provider: "x",
        externalHandle: "sokosumi",
        status: "active",
        connectedAt: new Date("2026-09-03T10:00:00.000Z"),
        disconnectedAt: null,
      },
    ]);
  });

  it("marks an active connection as requiring reauthorization when Composio expires it", async () => {
    socialConnectionFindManyMock.mockResolvedValue([
      { ...socialConnection, status: "active" },
    ]);
    socialConnectionFindUniqueMock.mockResolvedValue({
      ...socialConnection,
      status: "active",
    });
    socialConnectionUpdateMock.mockResolvedValue({
      ...socialConnection,
      status: "reauthorization_required",
    });
    getProjectXConnectedAccountMock.mockResolvedValue({
      id: "ca_old",
      status: "EXPIRED",
      toolkitSlug: "twitter",
      authConfigId: "ac_x",
      connectorUserId: `sokosumi:user:${USER_ID}`,
    });
    const { listProjectSocialConnections } = await import(
      "./project-social-connections.service"
    );

    await expect(
      listProjectSocialConnections({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ status: "reauthorization_required" }),
    ]);
    expect(socialConnectionAuditCreateMock).toHaveBeenCalledWith({
      data: {
        projectSocialConnectionId: SOCIAL_CONNECTION_ID,
        action: "reauthorization_required",
        actorId: "system",
        externalAccountId: "123",
        externalHandle: "sokosumi",
        providerOutcome: "expired",
      },
    });
  });
  it("retires grants and expires intents atomically without contacting Composio", async () => {
    socialConnectionFindManyMock.mockResolvedValue([socialConnection]);
    const { default: prisma } = await import("@/lib/db/prisma");
    const { retireProjectSocialConnectionsForClose } = await import(
      "./project-social-connections.service"
    );
    await prisma.$transaction((tx) =>
      retireProjectSocialConnectionsForClose(tx, PROJECT_ID, USER_ID),
    );
    expect(socialConnectionUpdateMock).toHaveBeenCalledWith({
      where: { id: SOCIAL_CONNECTION_ID },
      data: expect.objectContaining({
        status: "disconnected",
        activeExternalAccountKey: null,
      }),
    });
    expect(socialConnectionAuditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "project_close",
        providerOutcome: "local_disconnect",
        actorId: USER_ID,
      }),
    });
    expect(
      transactionClient.projectSocialConnectionIntent.updateMany,
    ).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID },
      data: { expiresAt: new Date() },
    });
    expect(socialConnectionFindManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({ audits: expect.anything() }),
        ]),
      }),
    });
    expect(revokeProjectXConnectionMock).not.toHaveBeenCalled();
  });

  it("retries failed close revocation using its durable audit", async () => {
    const { revokeProjectSocialConnectionForClose } = await import(
      "./project-social-connections.service"
    );
    const pending = {
      connectedAccountId: "ca_old",
      retirement: {
        auditId: "audit_close",
        connectedAccountId: "ca_old",
        socialConnectionId: SOCIAL_CONNECTION_ID,
      },
    };
    revokeProjectXConnectionMock.mockRejectedValueOnce(
      new Error("unavailable"),
    );
    await expect(
      revokeProjectSocialConnectionForClose(pending),
    ).rejects.toThrow("could not be revoked");
    expect(socialConnectionAuditUpdateMock).toHaveBeenLastCalledWith({
      where: { id: "audit_close" },
      data: { providerOutcome: "revocation_failed" },
    });
    await revokeProjectSocialConnectionForClose(pending);
    expect(socialConnectionAuditUpdateMock).toHaveBeenLastCalledWith({
      where: { id: "audit_close" },
      data: { providerOutcome: "revoked" },
    });
  });

  it("retains unfinished intents until permanent provider deletion succeeds", async () => {
    const { revokeProjectSocialConnectionForClose } = await import(
      "./project-social-connections.service"
    );
    deleteProjectXConnectionIntentMock.mockRejectedValueOnce(
      new Error("unavailable"),
    );
    await expect(
      revokeProjectSocialConnectionForClose({
        connectedAccountId: CONNECTION_ID,
      }),
    ).rejects.toThrow("unavailable");
    expect(socialConnectionIntentDeleteMock).not.toHaveBeenCalled();
    await revokeProjectSocialConnectionForClose({
      connectedAccountId: CONNECTION_ID,
    });
    expect(deleteProjectXConnectionIntentMock).toHaveBeenCalledWith({
      connectedAccountId: CONNECTION_ID,
    });
    expect(socialConnectionIntentDeleteMock).toHaveBeenCalledWith({
      where: { connectionId: CONNECTION_ID },
    });
  });
});
