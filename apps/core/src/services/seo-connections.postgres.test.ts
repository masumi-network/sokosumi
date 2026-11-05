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
import { resolveSeoStatisticsIntegration } from "./seo-connections.service";

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
    status: "ACTIVE";
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
        where: { userId: owner.userId, workspaceId: owner.workspaceId },
      });
      await prisma.seoConnection.deleteMany({
        where: { userId: owner.userId, workspaceId: owner.workspaceId },
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
  },
);
