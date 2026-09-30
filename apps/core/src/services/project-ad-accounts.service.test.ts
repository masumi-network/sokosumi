import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComposioConfigError } from "@/clients/composio.client";
import { notFound } from "@/helpers/error";

const m = vi.hoisted(() => ({
  getEnv: vi.fn(),
  getProjectSocialConnectedAccount: vi.fn(),
  initiateComposioConnection: vi.fn(),
  deleteIntentAtComposio: vi.fn(),
  revoke: vi.fn(),
  listGoogle: vi.fn(),
  listMeta: vi.fn(),
  requireScopedProject: vi.fn(),
  requireLockedOpenProject: vi.fn(),
  intentFindUnique: vi.fn(),
  intentCreate: vi.fn(),
  intentDelete: vi.fn(),
  connectionFindUnique: vi.fn(),
  connectionFindFirst: vi.fn(),
  connectionCreate: vi.fn(),
  connectionDelete: vi.fn(),
  accountFindMany: vi.fn(),
  accountFindFirst: vi.fn(),
  accountCount: vi.fn(),
  accountUpsert: vi.fn(),
  accountDelete: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/clients/composio.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/composio.client")>()),
  deleteProjectSocialConnectionIntent: m.deleteIntentAtComposio,
  getProjectSocialConnectedAccount: m.getProjectSocialConnectedAccount,
  initiateProjectSocialConnection: m.initiateComposioConnection,
  revokeProjectSocialConnection: m.revoke,
}));
vi.mock("@/config/env", () => ({
  getEnv: m.getEnv,
  getWebAppBaseUrl: () => "https://app.sokosumi.com",
}));
vi.mock("@/lib/ads/google-ads", () => ({ listGoogleAdAccounts: m.listGoogle }));
vi.mock("@/lib/ads/meta-ads", () => ({ listMetaAdAccounts: m.listMeta }));
vi.mock("@/services/project-social-connections.service", () => ({
  projectConnectorUserId: (userId: string) => `sokosumi:user:${userId}`,
  projectExecutorUserId: (projectId: string) =>
    `sokosumi:project-executor:${projectId}`,
  requireScopedProject: m.requireScopedProject,
  requireLockedOpenProject: m.requireLockedOpenProject,
}));

const tx = {
  projectSocialConnectionIntent: {
    create: m.intentCreate,
    findUnique: m.intentFindUnique,
    delete: m.intentDelete,
  },
  projectAdConnection: { create: m.connectionCreate },
};
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: (run: (client: typeof tx) => unknown) => run(tx),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: m.transaction,
    projectSocialConnectionIntent: {
      findUnique: m.intentFindUnique,
    },
    projectAdConnection: {
      findUnique: m.connectionFindUnique,
      findFirst: m.connectionFindFirst,
      delete: m.connectionDelete,
    },
    projectAdAccount: {
      findMany: m.accountFindMany,
      findFirst: m.accountFindFirst,
      count: m.accountCount,
      upsert: m.accountUpsert,
      delete: m.accountDelete,
    },
  },
}));

import {
  attachProjectAdAccounts,
  detachProjectAdAccount,
  finalizeProjectAdConnection,
  initiateProjectAdConnection,
} from "./project-ad-accounts.service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const CONNECTION_UUID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT_UUID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "user_1";
const scope = { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID };

const available = [
  {
    externalAccountId: "111",
    name: "Shop",
    currency: "EUR",
    timeZone: null,
    loginCustomerId: null,
  },
];

const storedConnection = {
  id: CONNECTION_UUID,
  projectId: PROJECT_ID,
  provider: "google_ads",
  composioConnectedAccountId: "ca_1",
  connectorUserId: `sokosumi:user:${USER_ID}`,
  status: "active",
  createdAt: new Date("2026-09-30T10:00:00.000Z"),
};

const intent = {
  connectionId: "ca_1",
  projectId: PROJECT_ID,
  initiatingUserId: USER_ID,
  provider: "google_ads",
  action: "connect",
  authConfigId: "ac_google",
  callbackRedeemedAt: new Date("2026-09-30T10:00:00.000Z"),
  expiresAt: new Date("2026-09-30T10:15:00.000Z"),
};

describe("project ad accounts service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T10:05:00.000Z"));
    m.getEnv.mockReturnValue({
      COMPOSIO_GOOGLEADS_AUTH_CONFIG_ID: "ac_google",
      COMPOSIO_METAADS_AUTH_CONFIG_ID: "ac_meta",
    });
    m.requireScopedProject.mockResolvedValue(undefined);
    m.requireLockedOpenProject.mockResolvedValue(undefined);
    m.listGoogle.mockResolvedValue(available);
    m.listMeta.mockResolvedValue(available);
    m.initiateComposioConnection.mockResolvedValue({
      connectionId: "ca_1",
      redirectUrl: "https://connect.composio.dev/link",
    });
    m.getProjectSocialConnectedAccount.mockResolvedValue({
      id: "ca_1",
      status: "ACTIVE",
      toolkitSlug: "googleads",
      authConfigId: "ac_google",
      connectorUserId: `sokosumi:user:${USER_ID}`,
    });
    m.connectionCreate.mockResolvedValue(storedConnection);
    m.transaction.mockImplementation((ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
    m.accountUpsert.mockImplementation(
      async (args: { create: Record<string, unknown> }) => ({
        id: ACCOUNT_UUID,
        ...args.create,
      }),
    );
    m.accountFindMany.mockResolvedValue([]);
  });

  describe("initiate", () => {
    it.each([
      ["google_ads", "ac_google"],
      ["meta_ads", "ac_meta"],
    ] as const)(
      "starts a %s link and stores an intent",
      async (provider, authConfigId) => {
        const result = await initiateProjectAdConnection({
          ...scope,
          userId: USER_ID,
          provider,
        });
        expect(result).toEqual({
          connectionId: "ca_1",
          redirectUrl: "https://connect.composio.dev/link",
        });
        expect(m.initiateComposioConnection).toHaveBeenCalledWith({
          authConfigId,
          connectorUserId: `sokosumi:user:${USER_ID}`,
          executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
          callbackUrl: "https://app.sokosumi.com/composio/callback",
        });
        expect(m.intentCreate).toHaveBeenCalledWith({
          data: expect.objectContaining({
            connectionId: "ca_1",
            projectId: PROJECT_ID,
            initiatingUserId: USER_ID,
            provider,
            action: "connect",
            authConfigId,
          }),
        });
      },
    );

    it("raises a configuration error when the auth config is missing", async () => {
      m.getEnv.mockReturnValue({});
      await expect(
        initiateProjectAdConnection({
          ...scope,
          userId: USER_ID,
          provider: "meta_ads",
        }),
      ).rejects.toBeInstanceOf(ComposioConfigError);
      expect(m.initiateComposioConnection).not.toHaveBeenCalled();
    });

    it("rejects a Project outside the Workspace", async () => {
      m.requireScopedProject.mockRejectedValue(notFound("Project not found"));
      await expect(
        initiateProjectAdConnection({
          ...scope,
          userId: USER_ID,
          provider: "google_ads",
        }),
      ).rejects.toBeInstanceOf(HTTPException);
      expect(m.initiateComposioConnection).not.toHaveBeenCalled();
    });
  });

  describe("finalize", () => {
    const input = { ...scope, userId: USER_ID, connectionId: "ca_1" };

    beforeEach(() => {
      m.connectionFindUnique.mockResolvedValue(null);
      m.intentFindUnique.mockResolvedValue(intent);
    });

    it("stores the connection, redeems the intent and lists accounts", async () => {
      const result = await finalizeProjectAdConnection(input);
      expect(m.connectionCreate).toHaveBeenCalledWith({
        data: {
          projectId: PROJECT_ID,
          provider: "google_ads",
          composioConnectedAccountId: "ca_1",
          connectorUserId: `sokosumi:user:${USER_ID}`,
          status: "active",
        },
      });
      expect(m.intentDelete).toHaveBeenCalledWith({
        where: { connectionId: "ca_1" },
      });
      expect(result).toEqual({
        connection: {
          id: CONNECTION_UUID,
          provider: "google_ads",
          status: "active",
          createdAt: storedConnection.createdAt,
        },
        availableAccounts: available,
      });
      expect(m.listGoogle).toHaveBeenCalledWith({
        connectedAccountId: "ca_1",
        executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
      });
    });

    it("lists Meta accounts for a meta_ads intent", async () => {
      m.intentFindUnique.mockResolvedValue({ ...intent, provider: "meta_ads" });
      m.getProjectSocialConnectedAccount.mockResolvedValue({
        id: "ca_1",
        status: "ACTIVE",
        toolkitSlug: "metaads",
        authConfigId: "ac_google",
        connectorUserId: `sokosumi:user:${USER_ID}`,
      });
      m.connectionCreate.mockResolvedValue({
        ...storedConnection,
        provider: "meta_ads",
      });
      const result = await finalizeProjectAdConnection(input);
      expect(result.connection.provider).toBe("meta_ads");
      expect(m.listMeta).toHaveBeenCalled();
      expect(m.listGoogle).not.toHaveBeenCalled();
    });

    it("returns the existing connection on retry without creating another", async () => {
      m.connectionFindUnique.mockResolvedValue(storedConnection);
      m.intentFindUnique.mockResolvedValue(null);
      const result = await finalizeProjectAdConnection(input);
      expect(result.connection.id).toBe(CONNECTION_UUID);
      expect(result.availableAccounts).toEqual(available);
      expect(m.connectionCreate).not.toHaveBeenCalled();
      expect(m.getProjectSocialConnectedAccount).not.toHaveBeenCalled();
    });

    it("hides a connection that belongs to another Project", async () => {
      m.connectionFindUnique.mockResolvedValue({
        ...storedConnection,
        projectId: OTHER_PROJECT_ID,
      });
      await expect(finalizeProjectAdConnection(input)).rejects.toMatchObject({
        status: 404,
      });
    });

    it.each([
      ["a social intent", { provider: "x" }],
      ["another user's intent", { initiatingUserId: "user_2" }],
      ["an unredeemed callback", { callbackRedeemedAt: null }],
      [
        "an expired intent",
        { expiresAt: new Date("2026-09-30T10:00:00.000Z") },
      ],
    ])("rejects %s", async (_label, changed) => {
      m.intentFindUnique.mockResolvedValue({ ...intent, ...changed });
      await expect(finalizeProjectAdConnection(input)).rejects.toMatchObject({
        status: 404,
      });
      expect(m.connectionCreate).not.toHaveBeenCalled();
    });

    it("keeps the intent when account discovery fails", async () => {
      m.listGoogle.mockRejectedValue(new Error("provider down"));
      await expect(finalizeProjectAdConnection(input)).rejects.toThrow(
        "provider down",
      );
      expect(m.connectionCreate).not.toHaveBeenCalled();
      expect(m.intentDelete).not.toHaveBeenCalled();
    });

    it("returns the winner when a concurrent finalize created the connection", async () => {
      m.connectionCreate.mockRejectedValue({ code: "P2002" });
      m.connectionFindUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(storedConnection);
      const result = await finalizeProjectAdConnection(input);
      expect(result.connection.id).toBe(CONNECTION_UUID);
    });
  });

  describe("attach", () => {
    const input = {
      ...scope,
      connectionId: CONNECTION_UUID,
      externalAccountIds: ["111"],
    };

    beforeEach(() => {
      m.connectionFindFirst.mockResolvedValue(storedConnection);
    });

    it("attaches an available account and upserts so re-attach is idempotent", async () => {
      const accounts = await attachProjectAdAccounts(input);
      expect(accounts).toHaveLength(1);
      expect(m.accountUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId_provider_externalAccountId: {
              projectId: PROJECT_ID,
              provider: "google_ads",
              externalAccountId: "111",
            },
          },
          create: expect.objectContaining({
            connectionId: CONNECTION_UUID,
            externalAccountId: "111",
            name: "Shop",
            currency: "EUR",
          }),
        }),
      );
    });

    it("rejects an id the connection cannot reach", async () => {
      await expect(
        attachProjectAdAccounts({
          ...input,
          externalAccountIds: ["111", "999"],
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(m.accountUpsert).not.toHaveBeenCalled();
    });

    it("rejects a connection of another Project", async () => {
      m.connectionFindFirst.mockResolvedValue(null);
      await expect(attachProjectAdAccounts(input)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("releases an older connection emptied by moving an account", async () => {
      m.accountFindMany.mockResolvedValue([{ connectionId: "old-connection" }]);
      m.connectionFindUnique.mockResolvedValue({
        id: "old-connection",
        composioConnectedAccountId: "ca_old",
        _count: { accounts: 0 },
      });
      await attachProjectAdAccounts(input);
      expect(m.revoke).toHaveBeenCalledWith({ connectedAccountId: "ca_old" });
      expect(m.connectionDelete).toHaveBeenCalledWith({
        where: { id: "old-connection" },
      });
    });
  });

  describe("detach", () => {
    const accountRow = {
      id: ACCOUNT_UUID,
      connectionId: CONNECTION_UUID,
      connection: storedConnection,
    };

    beforeEach(() => {
      m.accountFindFirst.mockResolvedValue(accountRow);
    });

    it("keeps the connection while other accounts use it", async () => {
      m.accountCount.mockResolvedValue(1);
      await detachProjectAdAccount({ ...scope, accountId: ACCOUNT_UUID });
      expect(m.accountDelete).toHaveBeenCalledWith({
        where: { id: ACCOUNT_UUID },
      });
      expect(m.revoke).not.toHaveBeenCalled();
      expect(m.connectionDelete).not.toHaveBeenCalled();
    });

    it("revokes and deletes the connection with its last account", async () => {
      m.accountCount.mockResolvedValue(0);
      await detachProjectAdAccount({ ...scope, accountId: ACCOUNT_UUID });
      expect(m.revoke).toHaveBeenCalledWith({ connectedAccountId: "ca_1" });
      expect(m.connectionDelete).toHaveBeenCalledWith({
        where: { id: CONNECTION_UUID },
      });
    });

    it("changes nothing when the revoke fails", async () => {
      m.accountCount.mockResolvedValue(0);
      m.revoke.mockRejectedValue(new Error("composio down"));
      await expect(
        detachProjectAdAccount({ ...scope, accountId: ACCOUNT_UUID }),
      ).rejects.toThrow("composio down");
      expect(m.connectionDelete).not.toHaveBeenCalled();
    });

    it("rejects an account of another Project", async () => {
      m.accountFindFirst.mockResolvedValue(null);
      await expect(
        detachProjectAdAccount({ ...scope, accountId: ACCOUNT_UUID }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
