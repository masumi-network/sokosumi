import type { Prisma } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComposioConfigError } from "@/clients/composio.client";
import { notFound } from "@/helpers/error";
import type { AdCampaignUpdate } from "@/lib/ads/campaigns";

const m = vi.hoisted(() => {
  const fns = {
    getEnv: vi.fn(),
    getComposioConnectedAccount: vi.fn(),
    initiateComposioConnection: vi.fn(),
    deleteIntentAtComposio: vi.fn(),
    revoke: vi.fn(),
    listGoogle: vi.fn(),
    listMeta: vi.fn(),
    googleCampaigns: vi.fn(),
    metaCampaigns: vi.fn(),
    googleUpdate: vi.fn(),
    metaUpdate: vi.fn(),
    googleCreate: vi.fn(),
    metaCreate: vi.fn(),
    requireScopedProject: vi.fn(),
    requireLockedOpenProject: vi.fn(),
    intentFindUnique: vi.fn(),
    intentCreate: vi.fn(),
    intentDelete: vi.fn(),
    intentDeleteMany: vi.fn(),
    connectionFindUnique: vi.fn(),
    connectionFindFirst: vi.fn(),
    connectionCreate: vi.fn(),
    connectionUpdate: vi.fn(),
    connectionUpdateMany: vi.fn(),
    connectionDeleteMany: vi.fn(),
    accountFindMany: vi.fn(),
    accountFindFirst: vi.fn(),
    accountCount: vi.fn(),
    accountUpsert: vi.fn(),
    accountDelete: vi.fn(),
  };
  return {
    ...fns,
    tx: {
      projectSocialConnectionIntent: {
        create: fns.intentCreate,
        findUnique: fns.intentFindUnique,
        delete: fns.intentDelete,
        deleteMany: fns.intentDeleteMany,
      },
      projectAdConnection: {
        findUnique: fns.connectionFindUnique,
        findFirst: fns.connectionFindFirst,
        create: fns.connectionCreate,
        update: fns.connectionUpdate,
        updateMany: fns.connectionUpdateMany,
        deleteMany: fns.connectionDeleteMany,
      },
      projectAdAccount: {
        findMany: fns.accountFindMany,
        findFirst: fns.accountFindFirst,
        count: fns.accountCount,
        upsert: fns.accountUpsert,
        delete: fns.accountDelete,
      },
    },
  };
});

vi.mock("@/clients/composio.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/composio.client")>()),
  deleteProjectSocialConnectionIntent: m.deleteIntentAtComposio,
  getComposioConnectedAccount: m.getComposioConnectedAccount,
  initiateComposioConnection: m.initiateComposioConnection,
  revokeComposioConnectedAccount: m.revoke,
}));
vi.mock("@/config/env", () => ({
  getEnv: m.getEnv,
  getWebAppBaseUrl: () => "https://app.sokosumi.com",
}));
vi.mock("@/lib/ads/google-ads", () => ({
  listGoogleAdAccounts: m.listGoogle,
  listGoogleCampaigns: m.googleCampaigns,
  updateGoogleCampaign: m.googleUpdate,
  createGoogleCampaign: m.googleCreate,
}));
vi.mock("@/lib/ads/meta-ads", () => ({
  listMetaAdAccounts: m.listMeta,
  listMetaCampaigns: m.metaCampaigns,
  updateMetaCampaign: m.metaUpdate,
  createMetaCampaign: m.metaCreate,
}));
vi.mock("@/services/project-social-connections.service", () => ({
  projectConnectorUserId: (userId: string) => `sokosumi:user:${userId}`,
  projectExecutorUserId: (projectId: string) =>
    `sokosumi:project-executor:${projectId}`,
  requireScopedProject: m.requireScopedProject,
  requireLockedOpenProject: m.requireLockedOpenProject,
}));

vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: (run: (client: typeof m.tx) => unknown) => run(m.tx),
}));
vi.mock("@/lib/db/prisma", () => ({ default: m.tx }));

import {
  attachProjectAdAccounts,
  createProjectAdCampaign,
  detachProjectAdAccount,
  discardProjectAdConnection,
  finalizeProjectAdConnection,
  getPendingProjectAdRevocation,
  initiateProjectAdConnection,
  listProjectAdCampaigns,
  revokeProjectAdConnectionForClose,
  updateProjectAdCampaign,
} from "./project-ad-accounts.service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const CONNECTION_UUID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT_UUID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "user_1";
const tx = m.tx as unknown as Prisma.TransactionClient;
const scope = { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID };

const available = [
  { externalAccountId: "111", name: "Shop", currency: "EUR", timeZone: null },
];

const storedConnection = {
  id: CONNECTION_UUID,
  projectId: PROJECT_ID,
  provider: "google_ads",
  composioConnectedAccountId: "ca_1",
  connectorUserId: `sokosumi:user:${USER_ID}`,
  status: "active",
  createdAt: new Date("2026-09-30T10:00:00.000Z"),
  updatedAt: new Date("2026-09-30T10:00:00.000Z"),
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

/** A stored ad account with its connection, as the service reads it. */
const accountRow = (
  provider: string,
  externalAccountId: string,
  status = "active",
  currency = "EUR",
) => ({
  id: ACCOUNT_UUID,
  provider,
  externalAccountId,
  currency,
  connection: { ...storedConnection, provider, status },
});

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
    m.getComposioConnectedAccount.mockResolvedValue({
      id: "ca_1",
      status: "ACTIVE",
      toolkitSlug: "googleads",
      authConfigId: "ac_google",
      connectorUserId: `sokosumi:user:${USER_ID}`,
    });
    m.connectionCreate.mockResolvedValue(storedConnection);
    m.accountUpsert.mockImplementation(
      async (args: { create: Record<string, unknown> }) => ({
        id: ACCOUNT_UUID,
        ...args.create,
      }),
    );
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
      m.intentFindUnique.mockResolvedValue({
        ...intent,
        provider: "meta_ads",
        authConfigId: "ac_meta",
      });
      m.getComposioConnectedAccount.mockResolvedValue({
        id: "ca_1",
        status: "ACTIVE",
        toolkitSlug: "metaads",
        authConfigId: "ac_meta",
        connectorUserId: `sokosumi:user:${USER_ID}`,
      });
      m.connectionCreate.mockResolvedValue({
        ...storedConnection,
        provider: "meta_ads",
      });
      const result = await finalizeProjectAdConnection(input);
      expect(result.connection?.provider).toBe("meta_ads");
      expect(m.listMeta).toHaveBeenCalled();
      expect(m.listGoogle).not.toHaveBeenCalled();
    });

    it("revokes a grant that reaches no ad accounts and stores nothing", async () => {
      m.listGoogle.mockResolvedValue([]);
      const result = await finalizeProjectAdConnection(input);
      expect(result).toEqual({ connection: null, availableAccounts: [] });
      expect(m.revoke).toHaveBeenCalledWith({ connectedAccountId: "ca_1" });
      expect(m.intentDeleteMany).toHaveBeenCalledWith({
        where: { connectionId: "ca_1" },
      });
      expect(m.connectionCreate).not.toHaveBeenCalled();
    });

    it("keeps the intent when revoking an empty grant fails", async () => {
      m.listGoogle.mockResolvedValue([]);
      m.revoke.mockRejectedValue(new Error("composio down"));
      await expect(finalizeProjectAdConnection(input)).rejects.toThrow(
        "composio down",
      );
      expect(m.intentDeleteMany).not.toHaveBeenCalled();
    });

    it("returns the existing connection on retry without creating another", async () => {
      m.connectionFindUnique.mockResolvedValue(storedConnection);
      m.intentFindUnique.mockResolvedValue(null);
      const result = await finalizeProjectAdConnection(input);
      expect(result.connection?.id).toBe(CONNECTION_UUID);
      expect(result.availableAccounts).toEqual(available);
      expect(m.connectionCreate).not.toHaveBeenCalled();
      expect(m.getComposioConnectedAccount).not.toHaveBeenCalled();
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

    it("fails loudly on a stored status outside the documented set", async () => {
      m.connectionFindUnique.mockResolvedValue({
        ...storedConnection,
        status: "weird",
      });
      await expect(finalizeProjectAdConnection(input)).rejects.toMatchObject({
        status: 500,
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
      expect(result.connection?.id).toBe(CONNECTION_UUID);
    });
  });

  describe("attach", () => {
    const input = {
      ...scope,
      adConnectionId: CONNECTION_UUID,
      externalAccountIds: ["111"],
    };

    beforeEach(() => {
      m.connectionFindFirst.mockResolvedValue(storedConnection);
      m.connectionFindUnique.mockResolvedValue(storedConnection);
    });

    it("creates a new account on the given connection", async () => {
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

    it("leaves an already attached account unchanged, so attaching twice is harmless", async () => {
      const first = await attachProjectAdAccounts(input);
      const second = await attachProjectAdAccounts(input);
      expect(second).toEqual(first);
      // An empty update is what keeps an existing row as it was.
      for (const [call] of m.accountUpsert.mock.calls) {
        expect(call.update).toEqual({});
      }
    });

    it("does nothing to other connections and never revokes", async () => {
      await attachProjectAdAccounts(input);
      expect(m.revoke).not.toHaveBeenCalled();
      expect(m.connectionDeleteMany).not.toHaveBeenCalled();
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

    it("reopens as active when a concurrent discard had already closed it", async () => {
      m.connectionFindFirst.mockResolvedValue({
        ...storedConnection,
        status: "disconnected",
      });
      m.revoke.mockRejectedValue(new Error("composio down"));
      await expect(
        discardProjectAdConnection({
          ...scope,
          adConnectionId: CONNECTION_UUID,
        }),
      ).rejects.toThrow("composio down");
      expect(m.connectionUpdateMany).toHaveBeenCalledWith({
        where: { id: CONNECTION_UUID, status: "disconnected" },
        data: { status: "active" },
      });
    });

    it("rejects a connection of another Project", async () => {
      m.connectionFindFirst.mockResolvedValue(null);
      await expect(attachProjectAdAccounts(input)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("rejects a connection closed by a concurrent detach", async () => {
      m.connectionFindUnique.mockResolvedValue({
        ...storedConnection,
        status: "disconnected",
      });
      await expect(attachProjectAdAccounts(input)).rejects.toMatchObject({
        status: 409,
      });
      expect(m.accountUpsert).not.toHaveBeenCalled();
    });
  });

  describe("list campaigns", () => {
    const campaign = {
      id: "1",
      name: "Brand",
      status: "ACTIVE",
      objective: null,
      dailyBudget: null,
      spend: 1,
      impressions: 10,
      clicks: 1,
      ctr: 0.1,
      cpc: 1,
      conversions: null,
    };
    const list = () =>
      listProjectAdCampaigns({
        ...scope,
        accountId: ACCOUNT_UUID,
        range: "LAST_7_DAYS",
      });

    it("lists Google campaigns of the customer with the account currency", async () => {
      m.accountFindFirst.mockResolvedValue(accountRow("google_ads", "111"));
      m.googleCampaigns.mockResolvedValue([campaign]);
      await expect(list()).resolves.toEqual({
        campaigns: [campaign],
        range: "LAST_7_DAYS",
        currency: "EUR",
      });
      expect(m.googleCampaigns).toHaveBeenCalledWith({
        connectedAccountId: "ca_1",
        executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
        customerId: "111",
        range: "LAST_7_DAYS",
      });
      expect(m.accountFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ACCOUNT_UUID, projectId: PROJECT_ID },
        }),
      );
      expect(m.metaCampaigns).not.toHaveBeenCalled();
    });

    it("lists Meta campaigns of the ad account", async () => {
      m.accountFindFirst.mockResolvedValue(accountRow("meta_ads", "act_9"));
      m.metaCampaigns.mockResolvedValue([]);
      await expect(list()).resolves.toMatchObject({ campaigns: [] });
      expect(m.metaCampaigns).toHaveBeenCalledWith(
        expect.objectContaining({
          adAccountId: "act_9",
          currency: "EUR",
          range: "LAST_7_DAYS",
        }),
      );
      expect(m.googleCampaigns).not.toHaveBeenCalled();
    });

    it("returns 404 for an account of another Project", async () => {
      m.accountFindFirst.mockResolvedValue(null);
      await expect(list()).rejects.toMatchObject({ status: 404 });
      expect(m.googleCampaigns).not.toHaveBeenCalled();
    });

    it("returns 409 when the connection is not active", async () => {
      m.accountFindFirst.mockResolvedValue(
        accountRow("google_ads", "111", "disconnected"),
      );
      await expect(list()).rejects.toMatchObject({ status: 409 });
      expect(m.googleCampaigns).not.toHaveBeenCalled();
    });

    it("does not touch the provider when the Project is not in the Workspace", async () => {
      m.requireScopedProject.mockRejectedValue(notFound("Project not found"));
      await expect(list()).rejects.toMatchObject({ status: 404 });
      expect(m.accountFindFirst).not.toHaveBeenCalled();
    });
  });

  describe("update campaign", () => {
    const update = (
      changes: AdCampaignUpdate = {
        status: "PAUSED",
      },
    ) =>
      updateProjectAdCampaign({
        ...scope,
        accountId: ACCOUNT_UUID,
        campaignId: "42",
        ...changes,
      });

    it("updates a Google campaign inside the attached customer", async () => {
      m.accountFindFirst.mockResolvedValue(accountRow("google_ads", "111"));
      await update({ status: "PAUSED", dailyBudget: 9 });
      expect(m.googleUpdate).toHaveBeenCalledWith({
        connectedAccountId: "ca_1",
        executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
        customerId: "111",
        campaignId: "42",
        status: "PAUSED",
        dailyBudget: 9,
      });
      expect(m.accountFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ACCOUNT_UUID, projectId: PROJECT_ID },
        }),
      );
      expect(m.metaUpdate).not.toHaveBeenCalled();
    });

    it("updates a Meta campaign inside the attached ad account", async () => {
      m.accountFindFirst.mockResolvedValue(accountRow("meta_ads", "act_9"));
      await update();
      expect(m.metaUpdate).toHaveBeenCalledWith({
        connectedAccountId: "ca_1",
        executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
        adAccountId: "act_9",
        campaignId: "42",
        status: "PAUSED",
      });
      expect(m.googleUpdate).not.toHaveBeenCalled();
    });

    it.each([
      ["JPY", 12.5],
      ["USD", 12.345],
    ])(
      "rejects a %s budget of %d with more decimals than the currency has",
      async (currency, dailyBudget) => {
        m.accountFindFirst.mockResolvedValue(
          accountRow("google_ads", "111", "active", currency),
        );
        await expect(update({ dailyBudget })).rejects.toMatchObject({
          status: 422,
          message: expect.stringContaining(currency),
        });
        expect(m.googleUpdate).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["JPY", 12],
      ["USD", 12.34],
      ["EUR", 12],
    ])("accepts a %s budget of %d", async (currency, dailyBudget) => {
      m.accountFindFirst.mockResolvedValue(
        accountRow("meta_ads", "act_9", "active", currency),
      );
      await update({ dailyBudget });
      expect(m.metaUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ dailyBudget }),
      );
    });

    it("returns 404 for an account of another Project", async () => {
      m.accountFindFirst.mockResolvedValue(null);
      await expect(update()).rejects.toMatchObject({ status: 404 });
      expect(m.googleUpdate).not.toHaveBeenCalled();
    });

    it("returns 409 when the connection is not active", async () => {
      m.accountFindFirst.mockResolvedValue(
        accountRow("meta_ads", "act_9", "disconnected"),
      );
      await expect(update()).rejects.toMatchObject({ status: 409 });
      expect(m.metaUpdate).not.toHaveBeenCalled();
    });

    it("does not touch the provider when the Project is not in the Workspace", async () => {
      m.requireScopedProject.mockRejectedValue(notFound("Project not found"));
      await expect(update()).rejects.toMatchObject({ status: 404 });
      expect(m.accountFindFirst).not.toHaveBeenCalled();
    });
  });

  describe("create campaign", () => {
    const create = (
      changes: Partial<Parameters<typeof createProjectAdCampaign>[0]> = {},
    ) =>
      createProjectAdCampaign({
        ...scope,
        accountId: ACCOUNT_UUID,
        name: "Spring sale",
        dailyBudget: 12.5,
        ...changes,
      });
    const connected = {
      connectedAccountId: "ca_1",
      executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
    };

    it("creates a Google campaign inside the attached customer, ignoring any objective", async () => {
      m.accountFindFirst.mockResolvedValue(accountRow("google_ads", "111"));
      m.googleCreate.mockResolvedValue("42");
      await expect(create({ objective: "OUTCOME_SALES" })).resolves.toEqual({
        id: "42",
      });
      expect(m.googleCreate).toHaveBeenCalledWith({
        ...connected,
        customerId: "111",
        name: "Spring sale",
        dailyBudget: 12.5,
      });
      expect(m.metaCreate).not.toHaveBeenCalled();
    });

    it("creates a Meta campaign with its objective inside the attached ad account", async () => {
      m.accountFindFirst.mockResolvedValue(accountRow("meta_ads", "act_9"));
      m.metaCreate.mockResolvedValue("120001");
      await expect(create({ objective: "OUTCOME_LEADS" })).resolves.toEqual({
        id: "120001",
      });
      expect(m.metaCreate).toHaveBeenCalledWith({
        ...connected,
        adAccountId: "act_9",
        name: "Spring sale",
        dailyBudget: 12.5,
        objective: "OUTCOME_LEADS",
      });
      expect(m.googleCreate).not.toHaveBeenCalled();
    });

    it("rejects a Meta campaign without an objective before calling Meta", async () => {
      m.accountFindFirst.mockResolvedValue(accountRow("meta_ads", "act_9"));
      await expect(create()).rejects.toMatchObject({
        status: 422,
        message: expect.stringContaining("objective"),
      });
      expect(m.metaCreate).not.toHaveBeenCalled();
    });

    it.each([
      ["JPY", 12.5],
      ["USD", 12.345],
    ])(
      "rejects a %s budget of %d with more decimals than the currency has",
      async (currency, dailyBudget) => {
        m.accountFindFirst.mockResolvedValue(
          accountRow("google_ads", "111", "active", currency),
        );
        await expect(create({ dailyBudget })).rejects.toMatchObject({
          status: 422,
          message: expect.stringContaining(currency),
        });
        expect(m.googleCreate).not.toHaveBeenCalled();
      },
    );

    it("returns 404 for an account of another Project", async () => {
      m.accountFindFirst.mockResolvedValue(null);
      await expect(create()).rejects.toMatchObject({ status: 404 });
      expect(m.googleCreate).not.toHaveBeenCalled();
    });

    it("returns 409 when the connection is not active", async () => {
      m.accountFindFirst.mockResolvedValue(
        accountRow("google_ads", "111", "disconnected"),
      );
      await expect(create()).rejects.toMatchObject({ status: 409 });
      expect(m.googleCreate).not.toHaveBeenCalled();
    });

    it("does not touch the provider when the Project is not in the Workspace", async () => {
      m.requireScopedProject.mockRejectedValue(notFound("Project not found"));
      await expect(create()).rejects.toMatchObject({ status: 404 });
      expect(m.accountFindFirst).not.toHaveBeenCalled();
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
      expect(m.connectionUpdate).not.toHaveBeenCalled();
      expect(m.revoke).not.toHaveBeenCalled();
    });

    it("closes, revokes and deletes the connection with its last account", async () => {
      m.accountCount.mockResolvedValue(0);
      await detachProjectAdAccount({ ...scope, accountId: ACCOUNT_UUID });
      expect(m.connectionUpdate).toHaveBeenCalledWith({
        where: { id: CONNECTION_UUID },
        data: { status: "disconnected" },
      });
      expect(m.revoke).toHaveBeenCalledWith({ connectedAccountId: "ca_1" });
      expect(m.connectionDeleteMany).toHaveBeenCalledWith({
        where: { id: CONNECTION_UUID },
      });
      const closed = m.connectionUpdate.mock.invocationCallOrder[0];
      const revoked = m.revoke.mock.invocationCallOrder[0];
      const deleted = m.connectionDeleteMany.mock.invocationCallOrder[0];
      expect(closed).toBeLessThan(revoked);
      expect(revoked).toBeLessThan(deleted);
    });

    it("reopens the connection and keeps everything when the revoke fails", async () => {
      m.accountCount.mockResolvedValue(0);
      m.revoke.mockRejectedValue(new Error("composio down"));
      await expect(
        detachProjectAdAccount({ ...scope, accountId: ACCOUNT_UUID }),
      ).rejects.toThrow("composio down");
      expect(m.connectionUpdateMany).toHaveBeenCalledWith({
        where: { id: CONNECTION_UUID, status: "disconnected" },
        data: { status: "active" },
      });
      expect(m.connectionDeleteMany).not.toHaveBeenCalled();
    });

    it("rejects an account of another Project", async () => {
      m.accountFindFirst.mockResolvedValue(null);
      await expect(
        detachProjectAdAccount({ ...scope, accountId: ACCOUNT_UUID }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("discard", () => {
    beforeEach(() => {
      m.connectionFindFirst.mockResolvedValue(storedConnection);
      m.accountCount.mockResolvedValue(0);
    });

    it("closes, revokes and deletes a connection without ad accounts", async () => {
      await discardProjectAdConnection({
        ...scope,
        adConnectionId: CONNECTION_UUID,
      });
      expect(m.connectionFindFirst).toHaveBeenCalledWith({
        where: { id: CONNECTION_UUID, projectId: PROJECT_ID },
      });
      expect(m.connectionUpdate).toHaveBeenCalledWith({
        where: { id: CONNECTION_UUID },
        data: { status: "disconnected" },
      });
      expect(m.revoke).toHaveBeenCalledWith({ connectedAccountId: "ca_1" });
      expect(m.connectionDeleteMany).toHaveBeenCalledWith({
        where: { id: CONNECTION_UUID },
      });
      const closed = m.connectionUpdate.mock.invocationCallOrder[0];
      const revoked = m.revoke.mock.invocationCallOrder[0];
      const deleted = m.connectionDeleteMany.mock.invocationCallOrder[0];
      expect(closed).toBeLessThan(revoked);
      expect(revoked).toBeLessThan(deleted);
    });

    it("refuses a connection that has ad accounts", async () => {
      m.accountCount.mockResolvedValue(1);
      await expect(
        discardProjectAdConnection({
          ...scope,
          adConnectionId: CONNECTION_UUID,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(m.connectionUpdate).not.toHaveBeenCalled();
      expect(m.revoke).not.toHaveBeenCalled();
      expect(m.connectionDeleteMany).not.toHaveBeenCalled();
    });

    it("rejects a connection of another Project", async () => {
      m.connectionFindFirst.mockResolvedValue(null);
      await expect(
        discardProjectAdConnection({
          ...scope,
          adConnectionId: CONNECTION_UUID,
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(m.revoke).not.toHaveBeenCalled();
    });

    it("reopens the connection and keeps the row when the revoke fails", async () => {
      m.revoke.mockRejectedValue(new Error("composio down"));
      await expect(
        discardProjectAdConnection({
          ...scope,
          adConnectionId: CONNECTION_UUID,
        }),
      ).rejects.toThrow("composio down");
      expect(m.connectionUpdateMany).toHaveBeenCalledWith({
        where: { id: CONNECTION_UUID, status: "disconnected" },
        data: { status: "active" },
      });
      expect(m.connectionDeleteMany).not.toHaveBeenCalled();
    });
  });

  describe("project close", () => {
    it("finds the next ad connection to revoke", async () => {
      m.connectionFindFirst.mockResolvedValue({
        id: CONNECTION_UUID,
        composioConnectedAccountId: "ca_1",
      });
      await expect(
        getPendingProjectAdRevocation(tx, PROJECT_ID),
      ).resolves.toEqual({
        adConnectionId: CONNECTION_UUID,
        connectedAccountId: "ca_1",
      });
      expect(m.connectionFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: PROJECT_ID } }),
      );
    });

    it("reports nothing pending when the Project has no ad connections", async () => {
      m.connectionFindFirst.mockResolvedValue(null);
      await expect(
        getPendingProjectAdRevocation(tx, PROJECT_ID),
      ).resolves.toBeNull();
    });

    it("revokes then deletes the connection", async () => {
      await revokeProjectAdConnectionForClose({
        adConnectionId: CONNECTION_UUID,
        connectedAccountId: "ca_1",
      });
      expect(m.revoke).toHaveBeenCalledWith({ connectedAccountId: "ca_1" });
      expect(m.connectionDeleteMany).toHaveBeenCalledWith({
        where: { id: CONNECTION_UUID },
      });
    });

    it("keeps the connection when the revoke fails", async () => {
      m.revoke.mockRejectedValue(new Error("composio down"));
      await expect(
        revokeProjectAdConnectionForClose({
          adConnectionId: CONNECTION_UUID,
          connectedAccountId: "ca_1",
        }),
      ).rejects.toThrow("composio down");
      expect(m.connectionDeleteMany).not.toHaveBeenCalled();
    });
  });
});
