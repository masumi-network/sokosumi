import { isSocialProviderEnabled } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PROJECT_SOCIAL_PROVIDERS,
  type ProjectSocialProvider,
} from "@/config/social-providers";

const {
  deleteSocialAccountAvatarIfOwnedMock,
  snapshotSocialAccountAvatarMock,
  deleteProjectSocialConnectionIntentMock,
  getConnectedSocialIdentityMock,
  lockCalendarScopeMock,
  getEnvMock,
  getComposioConnectedAccountMock,
  getWebAppBaseUrlMock,
  initiateComposioConnectionMock,
  projectFindFirstMock,
  revokeComposioConnectedAccountMock,
  socialConnectionAuditCreateMock,
  socialConnectionAuditFindFirstMock,
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
  socialConnectionUpdateManyMock,
  socialPostUpdateManyMock,
  transactionMock,
} = vi.hoisted(() => ({
  deleteSocialAccountAvatarIfOwnedMock: vi.fn(),
  snapshotSocialAccountAvatarMock: vi.fn(),
  deleteProjectSocialConnectionIntentMock: vi.fn(),
  getConnectedSocialIdentityMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  getEnvMock: vi.fn(),
  getComposioConnectedAccountMock: vi.fn(),
  getWebAppBaseUrlMock: vi.fn(),
  initiateComposioConnectionMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  revokeComposioConnectedAccountMock: vi.fn(),
  socialConnectionAuditCreateMock: vi.fn(),
  socialConnectionAuditFindFirstMock: vi.fn(),
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
  socialConnectionUpdateManyMock: vi.fn(),
  socialPostUpdateManyMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/clients/composio.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/composio.client")>()),
  deleteProjectSocialConnectionIntent: deleteProjectSocialConnectionIntentMock,
  getConnectedSocialIdentity: getConnectedSocialIdentityMock,
  getComposioConnectedAccount: getComposioConnectedAccountMock,
  initiateComposioConnection: initiateComposioConnectionMock,
  revokeComposioConnectedAccount: revokeComposioConnectedAccountMock,
}));

vi.mock("@/lib/social-account-avatar", () => ({
  deleteSocialAccountAvatarIfOwned: deleteSocialAccountAvatarIfOwnedMock,
  snapshotSocialAccountAvatar: snapshotSocialAccountAvatarMock,
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
    findUniqueOrThrow: socialConnectionFindUniqueMock,
    update: socialConnectionUpdateMock,
    updateMany: socialConnectionUpdateManyMock,
  },
  socialPost: {
    updateMany: socialPostUpdateManyMock,
  },
  projectSocialConnectionAudit: {
    create: socialConnectionAuditCreateMock,
    findFirst: socialConnectionAuditFindFirstMock,
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
      updateMany: socialConnectionUpdateManyMock,
    },
    projectSocialConnectionAudit: {
      findFirst: socialConnectionAuditFindFirstMock,
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
  displayName: null as string | null,
  avatarUrl: null as string | null,
  subscriptionType: null as string | null,
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
    callbackRedeemedAt: new Date("2026-09-03T10:00:00.000Z"),
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
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      workspace: { organization: null },
    });
    initiateComposioConnectionMock.mockResolvedValue({
      connectionId: CONNECTION_ID,
      redirectUrl: "https://connect.composio.dev/link-token",
    });
    getComposioConnectedAccountMock.mockResolvedValue({
      id: CONNECTION_ID,
      status: "ACTIVE",
      toolkitSlug: "twitter",
      authConfigId: "ac_x",
      connectorUserId: `sokosumi:user:${USER_ID}`,
    });
    getConnectedSocialIdentityMock.mockResolvedValue({
      id: "123",
      handle: "sokosumi",
      displayName: null,
      avatarUrl: null,
      subscriptionType: null,
    });
    snapshotSocialAccountAvatarMock.mockResolvedValue(null);
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
    socialPostUpdateManyMock.mockResolvedValue({ count: 0 });
    socialConnectionFindManyMock.mockResolvedValue([]);
    transactionMock.mockImplementation(
      async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    );
  });

  const providers = Object.keys(
    PROJECT_SOCIAL_PROVIDERS,
  ) as ProjectSocialProvider[];

  describe.each([null, "other", "utxo"])(
    "Project workspace %s",
    (organizationSlug) => {
      beforeEach(() => {
        projectFindFirstMock.mockResolvedValue({
          id: PROJECT_ID,
          workspace: {
            organization: organizationSlug ? { slug: organizationSlug } : null,
          },
        });
      });
      const enabledProviders = providers.filter((provider) =>
        isSocialProviderEnabled(provider, { organizationSlug }),
      );
      const disabledProviders = providers.filter(
        (provider) => !isSocialProviderEnabled(provider, { organizationSlug }),
      );

      it.each(enabledProviders)(
        "initiates %s with its configured OAuth credentials",
        async (provider) => {
          const { authConfigEnv } = PROJECT_SOCIAL_PROVIDERS[provider];
          getEnvMock.mockReturnValue({ [authConfigEnv]: `ac_${provider}` });
          const { initiateProjectSocialConnection } = await import(
            "./project-social-connections.service"
          );

          await initiateProjectSocialConnection({
            projectId: PROJECT_ID,
            workspaceId: WORKSPACE_ID,
            userId: USER_ID,
            action: "connect",
            provider,
          });

          expect(initiateComposioConnectionMock).toHaveBeenCalledWith(
            expect.objectContaining({
              authConfigId: `ac_${provider}`,
              connectorUserId: `sokosumi:user:${USER_ID}`,
              executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
            }),
          );
          expect(socialConnectionIntentCreateMock).toHaveBeenCalledWith({
            data: expect.objectContaining({
              provider,
              authConfigId: `ac_${provider}`,
            }),
          });
        },
      );

      it.each(enabledProviders)(
        "does not provision OAuth credentials for unconfigured %s",
        async (provider) => {
          getEnvMock.mockReturnValue({});
          const { initiateProjectSocialConnection } = await import(
            "./project-social-connections.service"
          );
          await expect(
            initiateProjectSocialConnection({
              projectId: PROJECT_ID,
              workspaceId: WORKSPACE_ID,
              userId: USER_ID,
              action: "connect",
              provider,
            }),
          ).rejects.toThrow(PROJECT_SOCIAL_PROVIDERS[provider].authConfigEnv);
          expect(initiateComposioConnectionMock).not.toHaveBeenCalled();
        },
      );

      it.each(enabledProviders)(
        "finalizes %s using its pinned intent and provider identity",
        async (provider) => {
          const intent = {
            ...createIntent("connect"),
            provider,
            authConfigId: `ac_${provider}`,
          };
          socialConnectionIntentFindUniqueMock.mockResolvedValue(intent);
          socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(
            intent,
          );
          getComposioConnectedAccountMock.mockResolvedValue({
            id: CONNECTION_ID,
            status: "ACTIVE",
            toolkitSlug: PROJECT_SOCIAL_PROVIDERS[provider].toolkitSlug,
            authConfigId: `ac_${provider}`,
            connectorUserId: `sokosumi:user:${USER_ID}`,
          });
          socialConnectionCreateMock.mockResolvedValue({
            ...socialConnection,
            provider,
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
          ).resolves.toMatchObject({ provider, status: "active" });
          expect(getConnectedSocialIdentityMock).toHaveBeenCalledWith({
            provider,
            connectedAccountId: CONNECTION_ID,
            executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
          });
          expect(socialConnectionCreateMock).toHaveBeenCalledWith({
            data: expect.objectContaining({
              provider,
              activeExternalAccountKey: `${provider}:123`,
            }),
          });
        },
      );

      it.each(enabledProviders)(
        "derives reconnect and replacement OAuth for stored %s",
        async (provider) => {
          const { initiateProjectSocialConnection } = await import(
            "./project-social-connections.service"
          );
          getEnvMock.mockReturnValue({
            [PROJECT_SOCIAL_PROVIDERS[provider].authConfigEnv]:
              `ac_${provider}`,
          });
          for (const action of ["reconnect", "replace"] as const) {
            socialConnectionFindFirstMock.mockResolvedValue({
              ...socialConnection,
              provider,
            });
            await initiateProjectSocialConnection({
              projectId: PROJECT_ID,
              workspaceId: WORKSPACE_ID,
              userId: USER_ID,
              action,
              socialConnectionId: SOCIAL_CONNECTION_ID,
            });
            expect(initiateComposioConnectionMock).toHaveBeenLastCalledWith(
              expect.objectContaining({ authConfigId: `ac_${provider}` }),
            );
            expect(socialConnectionIntentCreateMock).toHaveBeenLastCalledWith({
              data: expect.objectContaining({
                provider,
                action,
                authConfigId: `ac_${provider}`,
              }),
            });
          }
        },
      );

      it.each(enabledProviders)(
        "finalizes reconnect and replacement for %s",
        async (provider) => {
          const { finalizeProjectSocialConnection } = await import(
            "./project-social-connections.service"
          );
          for (const action of ["reconnect", "replace"] as const) {
            const intent = {
              ...createIntent(action),
              provider,
              authConfigId: `ac_${provider}`,
            };
            const target = {
              ...socialConnection,
              provider,
              status:
                action === "replace"
                  ? "disconnected"
                  : "reauthorization_required",
            };
            socialConnectionIntentFindUniqueMock.mockResolvedValue(intent);
            socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(
              intent,
            );
            socialConnectionFindFirstMock
              .mockResolvedValueOnce(target)
              .mockResolvedValueOnce(null);
            getComposioConnectedAccountMock.mockResolvedValue({
              id: CONNECTION_ID,
              status: "ACTIVE",
              toolkitSlug: PROJECT_SOCIAL_PROVIDERS[provider].toolkitSlug,
              authConfigId: `ac_${provider}`,
              connectorUserId: `sokosumi:user:${USER_ID}`,
            });
            socialConnectionCreateMock.mockResolvedValue({
              ...target,
              status: "active",
            });
            socialConnectionUpdateMock.mockResolvedValue({
              ...target,
              status: "active",
            });
            await expect(
              finalizeProjectSocialConnection({
                projectId: PROJECT_ID,
                workspaceId: WORKSPACE_ID,
                userId: USER_ID,
                connectionId: CONNECTION_ID,
              }),
            ).resolves.toMatchObject({ provider, status: "active" });
            expect(getConnectedSocialIdentityMock).toHaveBeenLastCalledWith({
              provider,
              connectedAccountId: CONNECTION_ID,
              executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
            });
          }
        },
      );

      if (disabledProviders.length) {
        it.each(
          disabledProviders.flatMap((provider) =>
            (["connect", "reconnect", "replace"] as const).map((action) => ({
              provider,
              action,
            })),
          ),
        )(
          "rejects $action for $provider before initiating or retiring credentials",
          async ({ provider, action }) => {
            socialConnectionFindFirstMock.mockResolvedValue({
              ...socialConnection,
              provider,
            });
            const { initiateProjectSocialConnection } = await import(
              "./project-social-connections.service"
            );

            await expect(
              initiateProjectSocialConnection({
                projectId: PROJECT_ID,
                workspaceId: WORKSPACE_ID,
                userId: USER_ID,
                ...(action === "connect"
                  ? { action, provider }
                  : { action, socialConnectionId: SOCIAL_CONNECTION_ID }),
              }),
            ).rejects.toMatchObject({
              status: 400,
              message: `${PROJECT_SOCIAL_PROVIDERS[provider].name} is coming soon. Available now: X, YouTube, and LinkedIn.`,
            });
            expect(initiateComposioConnectionMock).not.toHaveBeenCalled();
            expect(getComposioConnectedAccountMock).not.toHaveBeenCalled();
            expect(revokeComposioConnectedAccountMock).not.toHaveBeenCalled();
            expect(socialConnectionUpdateMock).not.toHaveBeenCalled();
            expect(socialConnectionIntentCreateMock).not.toHaveBeenCalled();
          },
        );

        it.each(
          disabledProviders.flatMap((provider) =>
            (["connect", "reconnect", "replace"] as const).map((action) => ({
              provider,
              action,
            })),
          ),
        )(
          "rejects finalizing $action for $provider before reading external credentials",
          async ({ provider, action }) => {
            socialConnectionIntentFindUniqueMock.mockResolvedValue({
              ...createIntent(action),
              provider,
              authConfigId: `ac_${provider}`,
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
            ).rejects.toMatchObject({
              status: 400,
              message: `${PROJECT_SOCIAL_PROVIDERS[provider].name} is coming soon. Available now: X, YouTube, and LinkedIn.`,
            });
            expect(getComposioConnectedAccountMock).not.toHaveBeenCalled();
            expect(getConnectedSocialIdentityMock).not.toHaveBeenCalled();
            expect(revokeComposioConnectedAccountMock).not.toHaveBeenCalled();
            expect(socialConnectionCreateMock).not.toHaveBeenCalled();
            expect(socialConnectionUpdateMock).not.toHaveBeenCalled();
          },
        );
      }
    },
  );

  it("does not retire a replacement target whose provider changes during locking", async () => {
    socialConnectionFindFirstMock
      .mockResolvedValueOnce(socialConnection)
      .mockResolvedValueOnce({ ...socialConnection, provider: "instagram" });
    const { initiateProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );
    await expect(
      initiateProjectSocialConnection({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        action: "replace",
        socialConnectionId: SOCIAL_CONNECTION_ID,
      }),
    ).rejects.toThrow("provider changed");
    expect(socialConnectionUpdateMock).not.toHaveBeenCalled();
    expect(initiateComposioConnectionMock).not.toHaveBeenCalled();
  });

  it.each(providers)(
    "lists and disconnects stored %s accounts",
    async (provider) => {
      const record = { ...socialConnection, provider, status: "active" };
      socialConnectionFindManyMock.mockResolvedValue([record]);
      socialConnectionFindFirstMock.mockResolvedValue(record);
      socialConnectionFindUniqueMock.mockResolvedValue(record);
      getComposioConnectedAccountMock.mockResolvedValue({
        id: "ca_old",
        status: "ACTIVE",
        toolkitSlug: PROJECT_SOCIAL_PROVIDERS[provider].toolkitSlug,
      });
      const {
        listProjectSocialConnections,
        disconnectProjectSocialConnection,
      } = await import("./project-social-connections.service");
      await expect(
        listProjectSocialConnections({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
        }),
      ).resolves.toMatchObject([{ provider, status: "active" }]);
      socialConnectionFindFirstMock
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce(null);
      await expect(
        disconnectProjectSocialConnection({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          socialConnectionId: SOCIAL_CONNECTION_ID,
        }),
      ).resolves.toMatchObject({
        connection: { provider, status: "disconnected" },
        providerRevocation: "succeeded",
      });
      expect(revokeComposioConnectedAccountMock).toHaveBeenCalledWith({
        connectedAccountId: "ca_old",
      });
    },
  );

  it.each(["reconnect", "replace"] as const)(
    "rejects a %s target from another provider even with the same identity id",
    async (action) => {
      socialConnectionIntentFindUniqueMock.mockResolvedValue(
        createIntent(action),
      );
      socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(
        createIntent(action),
      );
      socialConnectionFindFirstMock.mockResolvedValue({
        ...socialConnection,
        provider: "instagram",
        status:
          action === "replace" ? "disconnected" : "reauthorization_required",
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
      ).rejects.toThrow("provider must match");
      expect(socialConnectionCreateMock).not.toHaveBeenCalled();
      expect(socialConnectionUpdateMock).not.toHaveBeenCalled();
    },
  );

  it.each(["provider", "authConfigId"] as const)(
    "rejects an intent whose %s changes during identity lookup",
    async (field) => {
      socialConnectionIntentFindUniqueMock.mockResolvedValue(
        createIntent("connect"),
      );
      socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue({
        ...createIntent("connect"),
        [field]: field === "provider" ? "instagram" : "ac_other",
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
      expect(socialConnectionCreateMock).not.toHaveBeenCalled();
    },
  );

  it("rejects a connected account toolkit that differs from the intent provider", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("connect"),
    );
    getComposioConnectedAccountMock.mockResolvedValue({
      id: CONNECTION_ID,
      status: "ACTIVE",
      toolkitSlug: "instagram",
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
    ).rejects.toThrow("Unknown or expired connection");
    expect(getConnectedSocialIdentityMock).not.toHaveBeenCalled();
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
      expect(initiateComposioConnectionMock).not.toHaveBeenCalled();
      expect(socialConnectionCreateMock).not.toHaveBeenCalled();
    },
  );

  it("raises the caller's message for a closed Project, defaulting to the connect wording", async () => {
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      closedAt: new Date(),
    });
    const { requireScopedProject } = await import(
      "./project-social-connections.service"
    );
    const input = { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID };
    await expect(
      requireScopedProject(input, { requireOpen: true }),
    ).rejects.toThrow("Cannot connect accounts to a closing or closed Project");
    await expect(
      requireScopedProject(input, {
        requireOpen: true,
        closedMessage: "Cannot change a closing or closed Project",
      }),
    ).rejects.toThrow("Cannot change a closing or closed Project");
  });

  it("revokes an unreturned link when close wins during provider initiation", async () => {
    initiateComposioConnectionMock.mockImplementation(async () => {
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
    expect(deleteProjectSocialConnectionIntentMock).toHaveBeenCalledWith({
      connectedAccountId: CONNECTION_ID,
    });
  });

  it("does not finalize when close wins during identity lookup", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("connect"),
    );
    getConnectedSocialIdentityMock.mockImplementation(async () => {
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
      select: {
        id: true,
        closingAt: true,
        closedAt: true,
        workspace: { select: { organization: { select: { slug: true } } } },
      },
    });
    expect(initiateComposioConnectionMock).toHaveBeenCalledWith({
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

    expect(getComposioConnectedAccountMock).not.toHaveBeenCalled();
    expect(socialConnectionIntentDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects finalization before the initiating human redeems the callback", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue({
      ...createIntent("connect"),
      callbackRedeemedAt: null,
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

    expect(getComposioConnectedAccountMock).not.toHaveBeenCalled();
    expect(socialConnectionCreateMock).not.toHaveBeenCalled();
  });

  it("finalizes once after redemption and rejects a replay", async () => {
    let storedIntent: ReturnType<typeof createIntent> | null =
      createIntent("connect");
    socialConnectionIntentFindUniqueMock.mockImplementation(
      async () => storedIntent,
    );
    socialConnectionIntentFindUniqueInTransactionMock.mockImplementation(
      async () => storedIntent,
    );
    socialConnectionIntentDeleteMock.mockImplementation(async () => {
      storedIntent = null;
      return {};
    });
    const { finalizeProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );
    const input = {
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      connectionId: CONNECTION_ID,
    };

    await expect(finalizeProjectSocialConnection(input)).resolves.toMatchObject(
      {
        status: "active",
      },
    );
    await expect(finalizeProjectSocialConnection(input)).rejects.toThrow(
      "Unknown or expired connection",
    );
    expect(socialConnectionIntentDeleteMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a completed account without the initiating connector identity", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("connect"),
    );
    getComposioConnectedAccountMock.mockResolvedValue({
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

    expect(getConnectedSocialIdentityMock).not.toHaveBeenCalled();
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
      message: "This social account is already connected to the Project",
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
    getComposioConnectedAccountMock.mockResolvedValue({
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
        action: "reconnect",
        socialConnectionId: SOCIAL_CONNECTION_ID,
      }),
    ).rejects.toThrow("requires reauthorization");
    expect(initiateComposioConnectionMock).not.toHaveBeenCalled();
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
        action: "replace",
        socialConnectionId: SOCIAL_CONNECTION_ID,
      }),
    ).rejects.toThrow("live connection");

    expect(initiateComposioConnectionMock).not.toHaveBeenCalled();
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
        connectedAccountId: "ca_old",
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
    expect(revokeComposioConnectedAccountMock).toHaveBeenCalledWith({
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
    ).toBeLessThan(
      revokeComposioConnectedAccountMock.mock.invocationCallOrder[0]!,
    );
    expect(
      revokeComposioConnectedAccountMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      socialConnectionAuditUpdateMock.mock.invocationCallOrder[0]!,
    );
    expect(
      socialConnectionAuditUpdateMock.mock.invocationCallOrder[0],
    ).toBeLessThan(initiateComposioConnectionMock.mock.invocationCallOrder[0]!);
    expect(
      initiateComposioConnectionMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      socialConnectionIntentCreateMock.mock.invocationCallOrder[0]!,
    );
  });

  it("reconnects only the existing provider identity", async () => {
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
        displayName: null,
        subscriptionType: null,
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

  it("stores the profile and replaces the previous avatar on reconnect", async () => {
    const oldAvatar = "https://a.public.blob.vercel-storage.com/old.jpg";
    const newAvatar = "https://a.public.blob.vercel-storage.com/new.jpg";
    getConnectedSocialIdentityMock.mockResolvedValue({
      id: "123",
      handle: "sokosumi",
      displayName: "Sokosumi",
      subscriptionType: "Premium",
      avatarUrl: "https://pbs.twimg.com/a_400x400.jpg",
    });
    snapshotSocialAccountAvatarMock.mockResolvedValue(newAvatar);
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("reconnect"),
    );
    socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(
      createIntent("reconnect"),
    );
    socialConnectionFindFirstMock.mockResolvedValue({
      ...socialConnection,
      avatarUrl: oldAvatar,
    });
    socialConnectionUpdateMock.mockResolvedValue({
      ...socialConnection,
      displayName: "Sokosumi",
      subscriptionType: "Premium",
      avatarUrl: newAvatar,
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
    ).resolves.toMatchObject({
      displayName: "Sokosumi",
      avatarUrl: newAvatar,
      subscriptionType: "Premium",
    });

    expect(snapshotSocialAccountAvatarMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      provider: "x",
      externalAccountId: "123",
      avatarUrl: "https://pbs.twimg.com/a_400x400.jpg",
    });
    expect(socialConnectionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          displayName: "Sokosumi",
          subscriptionType: "Premium",
          avatarUrl: newAvatar,
        }),
      }),
    );
    expect(deleteSocialAccountAvatarIfOwnedMock).toHaveBeenCalledWith(
      oldAvatar,
      PROJECT_ID,
    );
  });

  it("keeps a replaced account's avatar, which its old posts still show", async () => {
    const oldAvatar = "https://a.public.blob.vercel-storage.com/old.jpg";
    const newAvatar = "https://a.public.blob.vercel-storage.com/new.jpg";
    getConnectedSocialIdentityMock.mockResolvedValue({
      id: "456",
      handle: "sokosumi-new",
      displayName: "Sokosumi New",
      avatarUrl: "https://pbs.twimg.com/b_400x400.jpg",
    });
    snapshotSocialAccountAvatarMock.mockResolvedValue(newAvatar);
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("replace"),
    );
    socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(
      createIntent("replace"),
    );
    const target = {
      ...socialConnection,
      status: "disconnected",
      avatarUrl: oldAvatar,
    };
    socialConnectionFindFirstMock
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(null);
    socialConnectionCreateMock.mockResolvedValue({
      ...socialConnection,
      externalAccountId: "456",
      avatarUrl: newAvatar,
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
    ).resolves.toMatchObject({ status: "active", avatarUrl: newAvatar });

    expect(deleteSocialAccountAvatarIfOwnedMock).not.toHaveBeenCalledWith(
      oldAvatar,
      PROJECT_ID,
    );
  });

  it("reconnects and keeps the previous avatar when the copy fails", async () => {
    getConnectedSocialIdentityMock.mockResolvedValue({
      id: "123",
      handle: "sokosumi",
      displayName: "Sokosumi",
      avatarUrl: "https://pbs.twimg.com/a_400x400.jpg",
    });
    snapshotSocialAccountAvatarMock.mockResolvedValue(null);
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("reconnect"),
    );
    socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(
      createIntent("reconnect"),
    );
    socialConnectionFindFirstMock.mockResolvedValue(socialConnection);
    socialConnectionUpdateMock.mockResolvedValue({
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
    ).resolves.toMatchObject({ status: "active" });
    expect(
      socialConnectionUpdateMock.mock.calls[0]?.[0].data,
    ).not.toHaveProperty("avatarUrl");
    expect(deleteSocialAccountAvatarIfOwnedMock).toHaveBeenCalledWith(
      null,
      PROJECT_ID,
    );
  });

  it("reconnects a legacy LinkedIn URN row and stores the bare person id", async () => {
    const intent = {
      ...createIntent("reconnect"),
      provider: "linkedin",
      authConfigId: "ac_linkedin",
    };
    getEnvMock.mockReturnValue({
      COMPOSIO_LINKEDIN_AUTH_CONFIG_ID: "ac_linkedin",
    });
    getComposioConnectedAccountMock.mockResolvedValue({
      id: CONNECTION_ID,
      status: "ACTIVE",
      toolkitSlug: PROJECT_SOCIAL_PROVIDERS.linkedin.toolkitSlug,
      authConfigId: "ac_linkedin",
      connectorUserId: `sokosumi:user:${USER_ID}`,
    });
    getConnectedSocialIdentityMock.mockResolvedValue({
      id: "alice",
      handle: null,
      displayName: "Alice Doe",
      avatarUrl: null,
      subscriptionType: null,
    });
    socialConnectionIntentFindUniqueMock.mockResolvedValue(intent);
    socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(intent);
    const legacy = {
      ...socialConnection,
      provider: "linkedin",
      externalAccountId: "urn:li:person:alice",
      activeExternalAccountKey: "linkedin:urn:li:person:alice",
    };
    socialConnectionFindFirstMock.mockResolvedValue(legacy);
    socialConnectionUpdateMock.mockResolvedValue({
      ...legacy,
      externalAccountId: "alice",
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
    ).resolves.toMatchObject({ provider: "linkedin", status: "active" });
    expect(socialConnectionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalAccountId: "alice",
          activeExternalAccountKey: "linkedin:alice",
        }),
      }),
    );
  });

  it("blocks connecting a LinkedIn person already held by a legacy URN row", async () => {
    const intent = {
      ...createIntent("connect"),
      provider: "linkedin",
      authConfigId: "ac_linkedin",
    };
    getEnvMock.mockReturnValue({
      COMPOSIO_LINKEDIN_AUTH_CONFIG_ID: "ac_linkedin",
    });
    getComposioConnectedAccountMock.mockResolvedValue({
      id: CONNECTION_ID,
      status: "ACTIVE",
      toolkitSlug: PROJECT_SOCIAL_PROVIDERS.linkedin.toolkitSlug,
      authConfigId: "ac_linkedin",
      connectorUserId: `sokosumi:user:${USER_ID}`,
    });
    getConnectedSocialIdentityMock.mockResolvedValue({
      id: "alice",
      handle: null,
      displayName: null,
      avatarUrl: null,
      subscriptionType: null,
    });
    socialConnectionIntentFindUniqueMock.mockResolvedValue(intent);
    socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(intent);
    socialConnectionFindFirstMock.mockResolvedValue({
      ...socialConnection,
      provider: "linkedin",
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
    expect(socialConnectionFindFirstMock).toHaveBeenCalledWith({
      where: {
        projectId: PROJECT_ID,
        activeExternalAccountKey: {
          in: ["linkedin:alice", "linkedin:urn:li:person:alice"],
        },
      },
    });
  });

  it("rejects a reconnect to a different provider identity", async () => {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      createIntent("reconnect"),
    );
    socialConnectionFindFirstMock.mockResolvedValue(socialConnection);
    socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(
      createIntent("reconnect"),
    );
    getConnectedSocialIdentityMock.mockResolvedValue({
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
        connectedAccountId: "ca_old",
        providerOutcome: "local_disconnect",
      },
    });
    expect(revokeComposioConnectedAccountMock).toHaveBeenCalledWith({
      connectedAccountId: "ca_old",
    });
    expect(socialConnectionAuditUpdateMock).toHaveBeenCalledWith({
      where: { id: "audit_retire" },
      data: { providerOutcome: "revoked" },
    });
  });

  it("recovers a failed reconnect revocation from the durable retirement audit", async () => {
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
    revokeComposioConnectedAccountMock.mockRejectedValueOnce(
      new Error("provider unavailable"),
    );
    const {
      finalizeProjectSocialConnection,
      getPendingProjectSocialRevocation,
      revokeProjectSocialConnectionForClose,
    } = await import("./project-social-connections.service");
    const { default: prisma } = await import("@/lib/db/prisma");

    await finalizeProjectSocialConnection({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      connectionId: CONNECTION_ID,
    });
    expect(socialConnectionAuditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "reconnect_retire",
        connectedAccountId: "ca_old",
      }),
    });

    socialConnectionAuditFindFirstMock.mockResolvedValue({
      id: "audit_retire",
      action: "reconnect_retire",
      connectedAccountId: "ca_old",
      providerOutcome: "revocation_failed",
      projectSocialConnection: {
        ...socialConnection,
        composioConnectedAccountId: CONNECTION_ID,
        status: "active",
      },
    });
    const pending = await prisma.$transaction((tx) =>
      getPendingProjectSocialRevocation(tx, PROJECT_ID),
    );

    expect(socialConnectionAuditFindFirstMock).toHaveBeenCalledWith({
      where: {
        action: {
          in: [
            "disconnect",
            "replace_retire",
            "reconnect_retire",
            "project_close",
          ],
        },
        providerOutcome: {
          in: ["local_disconnect", "revocation_failed"],
        },
        projectSocialConnection: { projectId: PROJECT_ID },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { projectSocialConnection: true },
    });
    expect(pending).toEqual({
      connectedAccountId: "ca_old",
      retirement: {
        auditId: "audit_retire",
        connectedAccountId: "ca_old",
        socialConnectionId: SOCIAL_CONNECTION_ID,
      },
    });

    if (!pending) throw new Error("Expected a pending social revocation");
    socialConnectionFindFirstMock.mockResolvedValueOnce(null);
    await revokeProjectSocialConnectionForClose(pending);
    expect(revokeComposioConnectedAccountMock).toHaveBeenLastCalledWith({
      connectedAccountId: "ca_old",
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
    expect(socialPostUpdateManyMock).toHaveBeenCalledWith({
      where: {
        projectId: PROJECT_ID,
        socialConnectionId: SOCIAL_CONNECTION_ID,
        status: { in: ["DRAFT", "NEEDS_APPROVAL", "SCHEDULED"] },
      },
      data: { socialConnectionId: SOCIAL_CONNECTION_ID },
    });
  });

  it("reassigns draft and scheduled posts onto the replacement connection", async () => {
    const replacementId = "66666666-6666-4666-8666-666666666666";
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
    socialConnectionCreateMock.mockResolvedValue({
      ...socialConnection,
      id: replacementId,
      composioConnectedAccountId: CONNECTION_ID,
      status: "active",
    });
    socialPostUpdateManyMock.mockResolvedValue({ count: 2 });
    const { finalizeProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    await finalizeProjectSocialConnection({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      connectionId: CONNECTION_ID,
    });

    expect(socialPostUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(socialPostUpdateManyMock).toHaveBeenCalledWith({
      where: {
        projectId: PROJECT_ID,
        socialConnectionId: SOCIAL_CONNECTION_ID,
        status: { in: ["DRAFT", "NEEDS_APPROVAL", "SCHEDULED"] },
      },
      data: { socialConnectionId: replacementId },
    });

    socialPostUpdateManyMock.mockClear();
    socialPostUpdateManyMock.mockResolvedValue({ count: 0 });
    await finalizeProjectSocialConnection({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      connectionId: CONNECTION_ID,
    });
    expect(socialPostUpdateManyMock).toHaveBeenCalledWith({
      where: {
        projectId: PROJECT_ID,
        socialConnectionId: SOCIAL_CONNECTION_ID,
        status: { in: ["DRAFT", "NEEDS_APPROVAL", "SCHEDULED"] },
      },
      data: { socialConnectionId: replacementId },
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
      action: "replace",
      socialConnectionId: SOCIAL_CONNECTION_ID,
    });

    expect(revokeComposioConnectedAccountMock).not.toHaveBeenCalled();
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
    revokeComposioConnectedAccountMock.mockRejectedValue(
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
    getComposioConnectedAccountMock.mockResolvedValue({
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
        displayName: null,
        avatarUrl: null,
        subscriptionType: null,
        accountType: null,
        status: "active",
        connectedAt: new Date("2026-09-03T10:00:00.000Z"),
        disconnectedAt: null,
      },
    ]);
  });

  it("lists connections from the database without calling Composio", async () => {
    socialConnectionFindManyMock.mockResolvedValue([
      { ...socialConnection, status: "active", avatarUrl: null },
    ]);
    getComposioConnectedAccountMock.mockResolvedValue({
      id: "ca_old",
      status: "EXPIRED",
      toolkitSlug: "twitter",
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
      expect.objectContaining({
        id: SOCIAL_CONNECTION_ID,
        status: "active",
        avatarUrl: null,
      }),
    ]);
    expect(getComposioConnectedAccountMock).not.toHaveBeenCalled();
    expect(getConnectedSocialIdentityMock).not.toHaveBeenCalled();
    expect(socialConnectionUpdateMock).not.toHaveBeenCalled();
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
    expect(revokeComposioConnectedAccountMock).not.toHaveBeenCalled();
  });

  it("does not duplicate a disconnected connection's pending retirement during close", async () => {
    socialConnectionFindManyMock.mockResolvedValue([
      { ...socialConnection, status: "disconnected" },
    ]);
    const { default: prisma } = await import("@/lib/db/prisma");
    const { retireProjectSocialConnectionsForClose } = await import(
      "./project-social-connections.service"
    );

    await prisma.$transaction((tx) =>
      retireProjectSocialConnectionsForClose(tx, PROJECT_ID, USER_ID),
    );

    expect(socialConnectionUpdateMock).not.toHaveBeenCalled();
    expect(socialConnectionAuditCreateMock).not.toHaveBeenCalled();
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
    revokeComposioConnectedAccountMock.mockRejectedValueOnce(
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
    deleteProjectSocialConnectionIntentMock.mockRejectedValueOnce(
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
    expect(deleteProjectSocialConnectionIntentMock).toHaveBeenCalledWith({
      connectedAccountId: CONNECTION_ID,
    });
    expect(socialConnectionIntentDeleteMock).toHaveBeenCalledWith({
      where: { connectionId: CONNECTION_ID },
    });
  });
});

describe("LinkedIn company page rows", () => {
  const PERSON_ROW_ID = "44444444-4444-4444-8444-444444444444";
  const PAGE_ROW_ID = "55555555-5555-4555-8555-555555555555";
  const personRow = {
    ...socialConnection,
    id: PERSON_ROW_ID,
    provider: "linkedin",
    externalAccountId: "person_42",
    externalHandle: "ada",
    composioConnectedAccountId: "ca_old",
    status: "active",
    activeExternalAccountKey: "linkedin:person_42",
  };
  const pageRow = {
    ...personRow,
    id: PAGE_ROW_ID,
    externalAccountId: "urn:li:organization:777",
    externalHandle: "example-company",
    displayName: "Example Company",
    activeExternalAccountKey: "linkedin:urn:li:organization:777",
  };

  function linkedInIntent(socialConnectionId: string) {
    return {
      ...createIntent("reconnect"),
      provider: "linkedin",
      authConfigId: "ac_li",
      socialConnectionId,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    lockCalendarScopeMock.mockResolvedValue(true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T10:00:00.000Z"));
    getEnvMock.mockReturnValue({ COMPOSIO_LINKEDIN_AUTH_CONFIG_ID: "ac_li" });
    getWebAppBaseUrlMock.mockReturnValue("https://app.sokosumi.com");
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      workspace: { organization: null },
    });
    socialConnectionAuditCreateMock.mockResolvedValue({ id: "audit_page" });
    socialConnectionAuditUpdateMock.mockResolvedValue({});
    socialConnectionUpdateManyMock.mockResolvedValue({ count: 1 });
    socialConnectionFindManyMock.mockResolvedValue([]);
    snapshotSocialAccountAvatarMock.mockResolvedValue(null);
    transactionMock.mockImplementation(
      async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    );
  });

  it("maps a page row to the organization account type", async () => {
    socialConnectionFindManyMock.mockResolvedValue([personRow, pageRow]);
    const { listProjectSocialConnections } = await import(
      "./project-social-connections.service"
    );

    const listed = await listProjectSocialConnections({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });

    expect(listed.map((row) => [row.id, row.accountType])).toEqual([
      [PERSON_ROW_ID, "personal"],
      [PAGE_ROW_ID, "organization"],
    ]);
  });

  it("keeps the shared authorization when a page is disconnected but the profile stays", async () => {
    socialConnectionFindFirstMock
      .mockResolvedValueOnce(pageRow)
      .mockResolvedValueOnce({ id: PERSON_ROW_ID });
    socialConnectionFindUniqueMock.mockResolvedValue(pageRow);
    const { disconnectProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    const result = await disconnectProjectSocialConnection({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      socialConnectionId: PAGE_ROW_ID,
    });

    expect(result.providerRevocation).toBe("skipped");
    expect(revokeComposioConnectedAccountMock).not.toHaveBeenCalled();
    expect(socialConnectionFindFirstMock).toHaveBeenLastCalledWith({
      where: {
        composioConnectedAccountId: "ca_old",
        status: { not: "disconnected" },
        NOT: { id: PAGE_ROW_ID },
      },
      select: { id: true },
    });
    expect(socialConnectionAuditUpdateMock).toHaveBeenCalledWith({
      where: { id: "audit_page" },
      data: { providerOutcome: "revocation_skipped_shared" },
    });
  });

  it("revokes the shared authorization once its last row is disconnected", async () => {
    socialConnectionFindFirstMock
      .mockResolvedValueOnce(personRow)
      .mockResolvedValueOnce(null);
    socialConnectionFindUniqueMock.mockResolvedValue(personRow);
    const { disconnectProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );

    const result = await disconnectProjectSocialConnection({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      socialConnectionId: PERSON_ROW_ID,
    });

    expect(result.providerRevocation).toBe("succeeded");
    expect(revokeComposioConnectedAccountMock).toHaveBeenCalledWith({
      connectedAccountId: "ca_old",
    });
  });

  it("skips close revocation while another Project still uses the authorization", async () => {
    socialConnectionFindFirstMock.mockResolvedValueOnce({
      id: "other-project-row",
    });
    const { revokeProjectSocialConnectionForClose } = await import(
      "./project-social-connections.service"
    );

    await revokeProjectSocialConnectionForClose({
      connectedAccountId: "ca_old",
      retirement: {
        auditId: "audit_close",
        connectedAccountId: "ca_old",
        socialConnectionId: PAGE_ROW_ID,
      },
    });

    expect(revokeComposioConnectedAccountMock).not.toHaveBeenCalled();
    expect(socialConnectionAuditUpdateMock).toHaveBeenCalledWith({
      where: { id: "audit_close" },
      data: { providerOutcome: "revocation_skipped_shared" },
    });
  });

  async function finalizeLinkedInReconnect(
    target: typeof personRow,
    identityId = "person_42",
  ) {
    socialConnectionIntentFindUniqueMock.mockResolvedValue(
      linkedInIntent(target.id),
    );
    socialConnectionIntentFindUniqueInTransactionMock.mockResolvedValue(
      linkedInIntent(target.id),
    );
    getComposioConnectedAccountMock.mockResolvedValue({
      id: CONNECTION_ID,
      status: "ACTIVE",
      toolkitSlug: "linkedin",
      authConfigId: "ac_li",
      connectorUserId: `sokosumi:user:${USER_ID}`,
    });
    getConnectedSocialIdentityMock.mockResolvedValue({
      id: identityId,
      handle: "ada",
      displayName: "Ada",
      avatarUrl: null,
      subscriptionType: null,
    });
    socialConnectionFindFirstMock
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(null);
    socialConnectionFindManyMock.mockResolvedValue(
      [personRow, pageRow].filter((row) => row.id !== target.id),
    );
    socialConnectionUpdateMock.mockResolvedValue({
      ...personRow,
      composioConnectedAccountId: CONNECTION_ID,
    });
    socialConnectionFindUniqueMock.mockResolvedValue({
      ...pageRow,
      composioConnectedAccountId: CONNECTION_ID,
    });
    socialConnectionAuditCreateMock
      .mockResolvedValueOnce({ id: "audit_retire" })
      .mockResolvedValueOnce({ id: "audit_reconnect" });
    const { finalizeProjectSocialConnection } = await import(
      "./project-social-connections.service"
    );
    return finalizeProjectSocialConnection({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      connectionId: CONNECTION_ID,
    });
  }

  it("moves page rows onto the new authorization when the profile reconnects", async () => {
    await expect(
      finalizeLinkedInReconnect({
        ...personRow,
        status: "reauthorization_required",
      }),
    ).resolves.toMatchObject({ id: PERSON_ROW_ID, accountType: "personal" });

    expect(socialConnectionFindManyMock).toHaveBeenCalledWith({
      where: {
        projectId: PROJECT_ID,
        provider: "linkedin",
        composioConnectedAccountId: "ca_old",
        status: { not: "disconnected" },
        NOT: { id: PERSON_ROW_ID },
      },
    });
    expect(socialConnectionUpdateMock).toHaveBeenCalledWith({
      where: { id: PERSON_ROW_ID },
      data: expect.objectContaining({
        composioConnectedAccountId: CONNECTION_ID,
        externalHandle: "ada",
      }),
    });
    expect(socialConnectionUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: [PAGE_ROW_ID] } },
      data: expect.objectContaining({
        composioConnectedAccountId: CONNECTION_ID,
        status: "active",
      }),
    });
    expect(revokeComposioConnectedAccountMock).toHaveBeenCalledWith({
      connectedAccountId: "ca_old",
    });
  });

  it("reconnects a page through the profile that added it, keeping the page identity", async () => {
    await expect(
      finalizeLinkedInReconnect({
        ...pageRow,
        status: "reauthorization_required",
      }),
    ).resolves.toMatchObject({
      id: PAGE_ROW_ID,
      displayName: "Example Company",
      accountType: "organization",
    });

    // The person's profile is written to the person row, never the page.
    expect(socialConnectionUpdateMock).toHaveBeenCalledTimes(1);
    expect(socialConnectionUpdateMock).toHaveBeenCalledWith({
      where: { id: PERSON_ROW_ID },
      data: expect.objectContaining({
        composioConnectedAccountId: CONNECTION_ID,
      }),
    });
    expect(socialConnectionUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: [PAGE_ROW_ID] } },
      data: expect.objectContaining({
        composioConnectedAccountId: CONNECTION_ID,
      }),
    });
  });

  it("rejects a page reconnect authorized by a different person", async () => {
    await expect(
      finalizeLinkedInReconnect(
        { ...pageRow, status: "reauthorization_required" },
        "someone_else",
      ),
    ).rejects.toThrow("Reconnect must match the existing account");
    expect(socialConnectionUpdateMock).not.toHaveBeenCalled();
    expect(socialConnectionUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("backfillLinkedInAccountProfile", () => {
  const linkedIn = {
    id: SOCIAL_CONNECTION_ID,
    projectId: PROJECT_ID,
    provider: "linkedin",
    status: "active",
    composioConnectedAccountId: "ca_li",
    externalAccountId: "urn:li:person:abc",
    avatarUrl: null as string | null,
  };
  const identity = {
    id: "abc",
    handle: "alice",
    displayName: "Alice Doe",
    avatarUrl: "https://media.licdn.com/dms/image/a.jpg",
    subscriptionType: null,
  };
  const stored =
    "https://blob.example/social-account-avatars/project/linkedin/a.jpg";

  beforeEach(() => {
    vi.resetAllMocks();
    getConnectedSocialIdentityMock.mockResolvedValue(identity);
    snapshotSocialAccountAvatarMock.mockResolvedValue(stored);
    socialConnectionUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it("stores the photo and a missing name for a LinkedIn account without one", async () => {
    const { backfillLinkedInAccountProfile } = await import(
      "./project-social-connections.service"
    );

    await expect(backfillLinkedInAccountProfile(linkedIn)).resolves.toBe(true);

    expect(getConnectedSocialIdentityMock).toHaveBeenCalledWith({
      provider: "linkedin",
      connectedAccountId: "ca_li",
      executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
    });
    expect(snapshotSocialAccountAvatarMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      provider: "linkedin",
      externalAccountId: "urn:li:person:abc",
      avatarUrl: identity.avatarUrl,
    });
    expect(socialConnectionUpdateManyMock).toHaveBeenCalledWith({
      where: { id: SOCIAL_CONNECTION_ID, status: "active", avatarUrl: null },
      data: { avatarUrl: stored },
    });
    expect(socialConnectionUpdateManyMock).toHaveBeenCalledWith({
      where: { id: SOCIAL_CONNECTION_ID, displayName: null },
      data: { displayName: "Alice Doe" },
    });
  });

  it.each([
    ["another provider", { provider: "x" }],
    ["an account that already has a photo", { avatarUrl: "https://a/b.jpg" }],
    ["an inactive account", { status: "reauthorization_required" }],
    ["a company page", { externalAccountId: "urn:li:organization:777" }],
  ])("skips %s without calling LinkedIn", async (_label, change) => {
    const { backfillLinkedInAccountProfile } = await import(
      "./project-social-connections.service"
    );

    await expect(
      backfillLinkedInAccountProfile({ ...linkedIn, ...change }),
    ).resolves.toBe(false);
    expect(getConnectedSocialIdentityMock).not.toHaveBeenCalled();
  });

  it("never stores another person's photo", async () => {
    getConnectedSocialIdentityMock.mockResolvedValue({
      ...identity,
      id: "someone-else",
    });
    const { backfillLinkedInAccountProfile } = await import(
      "./project-social-connections.service"
    );

    await expect(backfillLinkedInAccountProfile(linkedIn)).resolves.toBe(false);
    expect(snapshotSocialAccountAvatarMock).not.toHaveBeenCalled();
    expect(socialConnectionUpdateManyMock).not.toHaveBeenCalled();
  });

  it("removes its copy when the row got a photo meanwhile", async () => {
    socialConnectionUpdateManyMock.mockResolvedValue({ count: 0 });
    const { backfillLinkedInAccountProfile } = await import(
      "./project-social-connections.service"
    );

    await expect(backfillLinkedInAccountProfile(linkedIn)).resolves.toBe(false);
    expect(deleteSocialAccountAvatarIfOwnedMock).toHaveBeenCalledWith(
      stored,
      PROJECT_ID,
    );
  });

  it("never throws when the lookup fails", async () => {
    getConnectedSocialIdentityMock.mockRejectedValue(new Error("down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { backfillLinkedInAccountProfile } = await import(
      "./project-social-connections.service"
    );

    await expect(backfillLinkedInAccountProfile(linkedIn)).resolves.toBe(false);
    warn.mockRestore();
  });
});
