/** Opt-in lifecycle races against a migrated, disposable PostgreSQL database.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-integrations.service.postgres.test.ts
 */
import { randomUUID } from "node:crypto";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({ link: vi.fn(), remove: vi.fn() }));
vi.mock("@/clients/composio.client", () => ({
  getComposio: () => ({
    connectedAccounts: { link: mocks.link, delete: mocks.remove },
    toolkits: { get: async () => ({ name: "Gmail", meta: {} }) },
    authConfigs: {
      list: async () => ({
        items: [
          {
            id: "auth-fixture",
            toolkit: { slug: "gmail" },
            isComposioManaged: true,
          },
        ],
      }),
    },
  }),
}));
vi.mock("@/helpers/chat-room-mention-status", () => ({
  failOpenChatRoomMentions: async () => [],
  publishChatRoomMentionStatuses: async () => undefined,
}));

import prisma from "@/lib/db/prisma";

import { deleteSokoBot } from "./soko-bot-deletion.service";
import {
  connectSokoBotIntegration,
  disconnectSokoBotIntegration,
} from "./soko-bot-integrations.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("OAuth lifecycle PostgreSQL races", () => {
  let userId: string;
  let organizationId: string;
  let workspaceId: string;
  let botId: string;
  function input() {
    return {
      userId,
      workspaceId,
      provider: "gmail",
      returnUrl: "https://app.example/return",
    };
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    userId = randomUUID();
    organizationId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        name: "OAuth fixture",
        email: `${userId}@example.test`,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.organization.create({
      data: { id: organizationId, name: "OAuth fixture", slug: organizationId },
    });
    const workspace = await prisma.workspace.create({
      data: { organizationId },
    });
    workspaceId = workspace.id;
    const bot = await prisma.sokoBot.create({ data: { userId, workspaceId } });
    botId = bot.id;
    await prisma.sokoBotIntegration.create({
      data: {
        sokoBotId: botId,
        provider: "gmail",
        composioAccountId: "selected",
        pendingComposioAccountId: "original-pending",
        status: "ACTIVE",
      },
    });
    mocks.remove.mockResolvedValue({});
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("serializes concurrent replacements and cleans up exactly the superseded pending accounts", async () => {
    mocks.link.mockResolvedValueOnce({
      id: "attempt-one",
      redirectUrl: "https://connect.example/one",
    });
    mocks.link.mockResolvedValueOnce({
      id: "attempt-two",
      redirectUrl: "https://connect.example/two",
    });
    await Promise.all([
      connectSokoBotIntegration(input()),
      connectSokoBotIntegration(input()),
    ]);
    const row = await prisma.sokoBotIntegration.findUniqueOrThrow({
      where: { sokoBotId_provider: { sokoBotId: botId, provider: "gmail" } },
    });
    expect(row.composioAccountId).toBe("selected");
    expect(["attempt-one", "attempt-two"]).toContain(
      row.pendingComposioAccountId,
    );
    const superseded =
      row.pendingComposioAccountId === "attempt-one"
        ? "attempt-two"
        : "attempt-one";
    expect(mocks.remove.mock.calls.flat().sort()).toEqual(
      ["original-pending", superseded].sort(),
    );
  });

  it("rejects and cleans up an authorization when bot deletion wins during OAuth initiation", async () => {
    mocks.link.mockImplementationOnce(async () => {
      await deleteSokoBot(botId);
      return { id: "too-late", redirectUrl: "https://connect.example/late" };
    });
    await expect(connectSokoBotIntegration(input())).rejects.toThrow();
    expect(
      await prisma.sokoBotIntegration.count({ where: { sokoBotId: botId } }),
    ).toBe(0);
    expect(mocks.remove.mock.calls.flat().sort()).toEqual([
      "original-pending",
      "selected",
      "too-late",
    ]);
  });

  it("retains a new connection persisted while disconnect performs remote cleanup", async () => {
    mocks.link.mockResolvedValue({
      id: "new-connection",
      redirectUrl: "https://connect.example/new",
    });
    mocks.remove.mockImplementationOnce(async () => {
      await connectSokoBotIntegration(input());
    });
    await disconnectSokoBotIntegration(input());
    const row = await prisma.sokoBotIntegration.findUniqueOrThrow({
      where: { sokoBotId_provider: { sokoBotId: botId, provider: "gmail" } },
    });
    expect(row.composioAccountId).toBe("new-connection");
    expect(row.status).toBe("PENDING");
    expect(mocks.remove.mock.calls.flat().sort()).toEqual([
      "original-pending",
      "selected",
    ]);
  });
});
