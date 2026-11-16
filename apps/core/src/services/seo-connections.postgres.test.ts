import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import prisma from "@/lib/db/prisma";
import {
  completeSeoConnectionCallback,
  connectSeoConnection,
  disconnectSeoConnection,
  finalizeSeoConnection,
} from "./seo-connection-oauth.service";
import {
  getSeoConnection,
  recordSeoConnectionFailure,
  resolveSeoStatisticsIntegration,
} from "./seo-connections.service";

const network = vi.hoisted(() => ({
  link: vi.fn(),
  complete: vi.fn(),
  account: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@/clients/composio.client", () => ({
  getComposio: () => ({
    authConfigs: {
      list: async ({ toolkit }: { toolkit: string }) => ({
        items: [
          {
            id: `auth-${toolkit}`,
            toolkit: { slug: toolkit },
            isComposioManaged: true,
          },
        ],
      }),
    },
  }),
  initiateComposioConnection: network.link,
  completeComposioAuth: network.complete,
  getComposioConnectedAccount: network.account,
  deleteProjectSocialConnectionIntent: network.revoke,
}));

const database = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(
    database?.startsWith("postgres") &&
      ["127.0.0.1", "localhost"].includes(new URL(database).hostname),
  );
const owner = { userId: randomUUID(), workspaceId: randomUUID() };
const other = { userId: randomUUID(), workspaceId: randomUUID() };
const callback = "https://preprod.sokosumi.com/composio/callback";
const accounts = new Map<
  string,
  {
    id: string;
    status: "ACTIVE" | "REVOKED";
    toolkitSlug: string;
    authConfigId: string;
    connectorUserId: string;
  }
>();

describe.skipIf(!enabled)(
  "Native SEO connection lifecycle on isolated PostgreSQL",
  () => {
    beforeAll(async () => {
      for (const fixture of [owner, other])
        await prisma.user.create({
          data: {
            id: fixture.userId,
            name: "Native SEO connection fixture",
            email: `${fixture.userId}@example.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            workspace: { create: { id: fixture.workspaceId } },
          },
        });
    });
    beforeEach(async () => {
      vi.clearAllMocks();
      accounts.clear();
      await prisma.seoConnectionIntent.deleteMany({
        where: { OR: [owner, other] },
      });
      await prisma.seoConnection.deleteMany({
        where: { OR: [owner, other] },
      });
      network.link.mockImplementation(
        async (input: {
          authConfigId: string;
          connectorUserId: string;
          executorUserId: string;
        }) => {
          const id = randomUUID();
          expect(input.connectorUserId).toBe(input.executorUserId);
          accounts.set(id, {
            id,
            status: "ACTIVE",
            toolkitSlug: input.authConfigId.replace("auth-", ""),
            authConfigId: input.authConfigId,
            connectorUserId: input.connectorUserId,
          });
          return {
            connectionId: id,
            redirectUrl: `https://connect.composio.dev/${id}`,
          };
        },
      );
      network.complete.mockImplementation(
        async ({
          sessionUri,
          userId,
        }: {
          sessionUri: string;
          userId: string;
        }) => {
          const account = accounts.get(sessionUri);
          if (!account || account.connectorUserId !== userId)
            throw new Error("Invalid test authorization");
          return {
            connectedAccountId: account.id,
            toolkitSlug: account.toolkitSlug,
          };
        },
      );
      network.account.mockImplementation(async (id: string) =>
        accounts.get(id),
      );
      network.revoke.mockResolvedValue(undefined);
    });
    afterAll(async () => {
      await prisma.workspace.deleteMany({
        where: { id: { in: [owner.workspaceId, other.workspaceId] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [owner.userId, other.userId] } },
      });
      await prisma.$disconnect();
    });

    it("routes native Preview consent through the canonical Web handoff with its exact account", async () => {
      const returnUrl =
        "https://sokosumi-app-preprod-git-feat-seo-workspace.preview.sokosumi.com/seo/connections/callback?provider=ga4&seo_state=attempt-123";
      const linked = await connectSeoConnection(owner, "ga4", returnUrl);
      const handoff = new URL(linked.redirectUrl);
      expect(handoff.pathname).toBe("/composio/handoff");
      expect(handoff.searchParams.get("to")).toBe(
        `https://connect.composio.dev/${linked.connectionId}`,
      );
      expect(handoff.searchParams.get("return")).toBe(returnUrl);
      expect(handoff.searchParams.get("connection")).toBe(linked.connectionId);
      expect(
        await prisma.seoConnectionIntent.findUnique({
          where: { connectionId: linked.connectionId },
          select: { userId: true, workspaceId: true, callbackRedeemedAt: true },
        }),
      ).toEqual({ ...owner, callbackRedeemedAt: null });
      expect(network.complete).not.toHaveBeenCalled();
    });

    it("connects, finalizes, reuses and disconnects without creating a Soko Bot", async () => {
      const linked = await connectSeoConnection(owner, "ga4", callback);
      await expect(
        completeSeoConnectionCallback({
          userId: other.userId,
          connectionId: linked.connectionId,
          sessionUri: linked.connectionId,
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(network.complete).not.toHaveBeenCalled();
      await completeSeoConnectionCallback({
        userId: owner.userId,
        connectionId: linked.connectionId,
        sessionUri: linked.connectionId,
      });
      await expect(
        finalizeSeoConnection(owner, "ga4", linked.connectionId),
      ).resolves.toMatchObject({ status: "connected", source: "native" });
      await expect(
        finalizeSeoConnection(owner, "ga4", linked.connectionId),
      ).resolves.toMatchObject({ status: "connected" });
      expect(await resolveSeoStatisticsIntegration(owner, "ga4")).toMatchObject(
        {
          composioAccountId: linked.connectionId,
          entityId: `sokosumi:seo:${owner.workspaceId}:${owner.userId}`,
        },
      );
      expect(
        await prisma.sokoBot.count({ where: { userId: owner.userId } }),
      ).toBe(0);
      await disconnectSeoConnection(owner, "ga4");
      expect(await resolveSeoStatisticsIntegration(owner, "ga4")).toBeNull();
      expect(network.revoke).toHaveBeenCalledWith({
        connectedAccountId: linked.connectionId,
      });
      await expect(
        finalizeSeoConnection(owner, "ga4", linked.connectionId),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("fences superseded and disconnected callbacks before redemption", async () => {
      const first = await connectSeoConnection(
        owner,
        "search_console",
        callback,
      );
      const second = await connectSeoConnection(
        owner,
        "search_console",
        callback,
      );
      await expect(
        completeSeoConnectionCallback({
          userId: owner.userId,
          connectionId: first.connectionId,
          sessionUri: first.connectionId,
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(network.complete).not.toHaveBeenCalled();
      expect(network.revoke).toHaveBeenCalledWith({
        connectedAccountId: first.connectionId,
      });
      await disconnectSeoConnection(owner, "search_console");
      await expect(
        completeSeoConnectionCallback({
          userId: owner.userId,
          connectionId: second.connectionId,
          sessionUri: second.connectionId,
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(network.complete).not.toHaveBeenCalled();
    });
    it("revokes expired unfinished attempts only for the same owner and provider", async () => {
      const expired = await connectSeoConnection(owner, "ga4", callback);
      const foreign = await connectSeoConnection(other, "ga4", callback);
      const differentProvider = await connectSeoConnection(
        owner,
        "search_console",
        callback,
      );
      await prisma.seoConnectionIntent.update({
        where: { connectionId: expired.connectionId },
        data: { expiresAt: new Date(0) },
      });
      network.revoke.mockClear();
      await connectSeoConnection(owner, "ga4", callback);
      expect(network.revoke).toHaveBeenCalledExactlyOnceWith({
        connectedAccountId: expired.connectionId,
      });
      expect(network.revoke).not.toHaveBeenCalledWith({
        connectedAccountId: foreign.connectionId,
      });
      expect(network.revoke).not.toHaveBeenCalledWith({
        connectedAccountId: differentProvider.connectionId,
      });
    });

    it("keeps new pending consent when revoking an older account fails", async () => {
      const previous = await connectSeoConnection(owner, "ga4", callback);
      network.revoke.mockRejectedValueOnce(
        new Error("Provider cleanup HTTP 503"),
      );
      const next = await connectSeoConnection(owner, "ga4", callback);
      const persisted = await prisma.seoConnectionIntent.findUnique({
        where: { connectionId: next.connectionId },
      });
      expect(persisted?.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(network.revoke).toHaveBeenCalledExactlyOnceWith({
        connectedAccountId: previous.connectionId,
      });
      await completeSeoConnectionCallback({
        userId: owner.userId,
        connectionId: next.connectionId,
        sessionUri: next.connectionId,
      });
      await expect(
        finalizeSeoConnection(owner, "ga4", next.connectionId),
      ).resolves.toMatchObject({ status: "connected" });
    });

    it("completes an owner-bound native callback without a popup account id", async () => {
      const linked = await connectSeoConnection(owner, "ga4", callback);
      await expect(
        finalizeSeoConnection(owner, "ga4", undefined, linked.connectionId),
      ).resolves.toMatchObject({ status: "connected", source: "native" });
      expect(network.complete).toHaveBeenCalledExactlyOnceWith({
        sessionUri: linked.connectionId,
        userId: `sokosumi:seo:${owner.workspaceId}:${owner.userId}`,
      });
      await expect(
        finalizeSeoConnection(other, "ga4", undefined, linked.connectionId),
      ).rejects.toMatchObject({ status: 404 });
      expect(network.complete).toHaveBeenCalledTimes(1);
    });

    it("resumes account verification after redeeming a one-use callback", async () => {
      const linked = await connectSeoConnection(owner, "ga4", callback);
      network.account.mockRejectedValueOnce(
        new Error("Account metadata HTTP 503"),
      );
      await expect(
        completeSeoConnectionCallback({
          userId: owner.userId,
          connectionId: linked.connectionId,
          sessionUri: linked.connectionId,
        }),
      ).rejects.toThrow("Account metadata HTTP 503");
      expect(
        (
          await prisma.seoConnectionIntent.findUnique({
            where: { connectionId: linked.connectionId },
          })
        )?.callbackRedeemedAt,
      ).not.toBeNull();
      await expect(
        finalizeSeoConnection(owner, "ga4", linked.connectionId),
      ).resolves.toMatchObject({ status: "connected" });
      expect(network.complete).toHaveBeenCalledTimes(1);
    });

    it("reports a committed connection even when old active account cleanup fails", async () => {
      const first = await connectSeoConnection(owner, "ga4", callback);
      await completeSeoConnectionCallback({
        userId: owner.userId,
        connectionId: first.connectionId,
        sessionUri: first.connectionId,
      });
      await finalizeSeoConnection(owner, "ga4", first.connectionId);
      const next = await connectSeoConnection(owner, "ga4", callback);
      await completeSeoConnectionCallback({
        userId: owner.userId,
        connectionId: next.connectionId,
        sessionUri: next.connectionId,
      });
      network.revoke.mockRejectedValueOnce(
        new Error("Old account cleanup HTTP 503"),
      );
      await expect(
        finalizeSeoConnection(owner, "ga4", next.connectionId),
      ).resolves.toMatchObject({ status: "connected" });
      expect(await resolveSeoStatisticsIntegration(owner, "ga4")).toMatchObject(
        {
          composioAccountId: next.connectionId,
        },
      );
    });

    it("marks explicitly revoked consent for reconnect without polling on status reads", async () => {
      const linked = await connectSeoConnection(owner, "ga4", callback);
      await finalizeSeoConnection(owner, "ga4", undefined, linked.connectionId);
      const integration = await resolveSeoStatisticsIntegration(owner, "ga4");
      const account = accounts.get(linked.connectionId);
      if (!integration || !account) throw new Error("Missing fixture account");
      account.status = "REVOKED";
      await recordSeoConnectionFailure(owner, "ga4", integration);
      network.account.mockClear();
      expect(await getSeoConnection(owner, "ga4")).toMatchObject({
        status: "needs_reconnect",
      });
      expect(await resolveSeoStatisticsIntegration(owner, "ga4")).toBeNull();
      expect(network.account).not.toHaveBeenCalled();
    });

    it("does not demote a replacement account when an older failed read settles late", async () => {
      const first = await connectSeoConnection(owner, "ga4", callback);
      await finalizeSeoConnection(owner, "ga4", undefined, first.connectionId);
      const previous = await resolveSeoStatisticsIntegration(owner, "ga4");
      if (!previous) throw new Error("Missing fixture integration");
      const next = await connectSeoConnection(owner, "ga4", callback);
      await finalizeSeoConnection(owner, "ga4", undefined, next.connectionId);
      const previousAccount = accounts.get(first.connectionId);
      if (!previousAccount) throw new Error("Missing fixture account");
      previousAccount.status = "REVOKED";
      await recordSeoConnectionFailure(owner, "ga4", previous);
      expect(await resolveSeoStatisticsIntegration(owner, "ga4")).toMatchObject(
        { composioAccountId: next.connectionId },
      );
      network.account.mockRejectedValueOnce(
        new Error("Provider outage HTTP 503"),
      );
      const current = await resolveSeoStatisticsIntegration(owner, "ga4");
      if (!current) throw new Error("Missing replacement integration");
      await recordSeoConnectionFailure(owner, "ga4", current);
      expect(await getSeoConnection(owner, "ga4")).toMatchObject({
        status: "connected",
      });
    });

    it("keeps reused assistant consent separate when SEO requests a native reconnect", async () => {
      const bot = await prisma.sokoBot.create({ data: owner });
      const personalId = randomUUID();
      try {
        const personal = await prisma.sokoBotIntegration.create({
          data: {
            sokoBotId: bot.id,
            provider: "google_analytics",
            composioAccountId: personalId,
            connectorUserId: owner.userId,
            status: "ACTIVE",
          },
        });
        accounts.set(personalId, {
          id: personalId,
          status: "REVOKED",
          toolkitSlug: "google_analytics",
          authConfigId: "auth-google_analytics",
          connectorUserId: `sokobot:${bot.id}`,
        });
        const integration = await resolveSeoStatisticsIntegration(owner, "ga4");
        if (!integration) throw new Error("Missing reused fixture integration");
        await recordSeoConnectionFailure(owner, "ga4", integration);
        expect(
          await prisma.seoConnection.findUnique({
            where: {
              workspaceId_userId_provider: { ...owner, provider: "ga4" },
            },
          }),
        ).toMatchObject({ status: "NEEDS_RECONNECT", composioAccountId: null });
        const linked = await connectSeoConnection(owner, "ga4", callback);
        await finalizeSeoConnection(
          owner,
          "ga4",
          undefined,
          linked.connectionId,
        );
        expect(network.revoke).not.toHaveBeenCalledWith({
          connectedAccountId: personalId,
        });
        expect(
          await prisma.sokoBotIntegration.findUnique({
            where: { id: personal.id },
          }),
        ).toMatchObject({ status: "ACTIVE", composioAccountId: personalId });
      } finally {
        await prisma.sokoBot.delete({ where: { id: bot.id } });
      }
    });
  },
);
